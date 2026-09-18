#!/usr/bin/env bash
# Build llama.cpp on the Arduino board and fetch one GGUF per quantization.
#
# The QRB2210 (qcm2290) exposes only /dev/fastrpc-adsp and an `adsp` remoteproc:
# there is no cDSP and no HTP, so llama.cpp's Hexagon backend cannot load here.
# This builds the CPU backend, and the sweep reports `cpu` accordingly.
set -euo pipefail

ROOT="${HOME}/hexsim"
VENV="${ROOT}/venv"
SRC="${ROOT}/llama.cpp"
BUILD="${SRC}/build"
PREFIX="${ROOT}/llama"
MODELS="${ROOT}/models"

# 135M keeps the whole sweep fast on four Cortex-A53 cores and under ~700 MB.
HF_REPO="bartowski/SmolLM2-135M-Instruct-GGUF"
HF_PREFIX="SmolLM2-135M-Instruct"
QUANTS=(Q4_0 Q4_K_M Q5_K_M Q8_0 f16)

log() { printf '\n== %s ==\n' "$1"; }

log "toolchain"
mkdir -p "${ROOT}"
[ -d "${VENV}" ] || python3 -m venv "${VENV}"
"${VENV}/bin/pip" install --quiet --upgrade pip
"${VENV}/bin/pip" install --quiet cmake ninja
# cmake resolves the generator from PATH, and pip installs both into the venv.
export PATH="${VENV}/bin:${PATH}"
CMAKE="${VENV}/bin/cmake"
NINJA="${VENV}/bin/ninja"
"${CMAKE}" --version | head -1

log "source"
if [ ! -d "${SRC}/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "${SRC}"
fi
git -C "${SRC}" log -1 --oneline

log "build"
# libcurl headers are absent and sudo needs a password, so LLAMA_CURL is off and
# models are fetched with the curl binary instead.
"${CMAKE}" -S "${SRC}" -B "${BUILD}" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="${NINJA}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=OFF \
  -DGGML_NATIVE=ON \
  -DBUILD_SHARED_LIBS=ON
# -j2 keeps peak resident size inside the board's 3.6 GB.
"${CMAKE}" --build "${BUILD}" --target llama-bench -j2

mkdir -p "${PREFIX}/bin" "${PREFIX}/lib"
find "${BUILD}/bin" -maxdepth 1 -type f -name 'llama-*' -exec cp -f {} "${PREFIX}/bin/" \;
find "${BUILD}" -name '*.so*' -type f -exec cp -f {} "${PREFIX}/lib/" \;
echo "installed: $(ls "${PREFIX}/bin")"

log "models"
mkdir -p "${MODELS}"
for q in "${QUANTS[@]}"; do
  out="${MODELS}/${HF_PREFIX}-${q}.gguf"
  if [ ! -s "${out}" ]; then
    echo "fetching ${q}"
    curl -fL --retry 3 --progress-bar \
      "https://huggingface.co/${HF_REPO}/resolve/main/${HF_PREFIX}-${q}.gguf" -o "${out}.part"
    mv "${out}.part" "${out}"
  fi
done
ls -lh "${MODELS}"

log "smoke test"
LD_LIBRARY_PATH="${PREFIX}/lib" "${PREFIX}/bin/llama-bench" \
  -m "${MODELS}/${HF_PREFIX}-Q4_0.gguf" -p 16 -n 8 -r 1 -t 4

log "done"
