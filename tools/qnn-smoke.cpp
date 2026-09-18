#if defined(__linux__) && defined(__aarch64__)

#include <QnnInterface.h>
#include <QnnOpDef.h>
#include <HTP/QnnHtpCommon.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using Json = nlohmann::json;
constexpr uint32_t width = 64;
constexpr uint32_t batch = 32;
constexpr uint32_t elements = batch * width;

void check(Qnn_ErrorHandle_t result, const char* operation) {
    if (result != QNN_SUCCESS) {
        throw std::runtime_error(std::string(operation) + " failed: " + std::to_string(result));
    }
}

void logMessage(const char* message, QnnLog_Level_t, uint64_t, va_list arguments) {
    std::vfprintf(stderr, message, arguments);
    std::fputc('\n', stderr);
}

void writeBytes(const std::filesystem::path& path, const void* data, size_t bytes) {
    std::ofstream file(path, std::ios::binary);
    file.write(static_cast<const char*>(data), bytes);
    file.close();
    if (!file) throw std::runtime_error("Cannot write " + path.string());
}

struct Session {
    void* library = nullptr;
    std::vector<uint8_t> contextBinary;
    QNN_INTERFACE_VER_TYPE api{};
    Qnn_LogHandle_t log = nullptr;
    Qnn_BackendHandle_t backend = nullptr;
    Qnn_DeviceHandle_t device = nullptr;
    Qnn_ContextHandle_t context = nullptr;

    ~Session() {
        if (context) api.contextFree(context, nullptr);
        if (device) api.deviceFree(device);
        if (backend) api.backendFree(backend);
        if (log) api.logFree(log);
        if (library) dlclose(library);
    }
};

Qnn_Tensor_t makeTensor(const char* name, Qnn_TensorType_t kind,
                       uint32_t* dimensions, uint8_t* data, uint32_t bytes) {
    Qnn_Tensor_t tensor = QNN_TENSOR_INIT;
    tensor.version = QNN_TENSOR_VERSION_1;
    tensor.v1.name = name;
    tensor.v1.type = kind;
    tensor.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    tensor.v1.dataType = QNN_DATATYPE_UFIXED_POINT_8;
    tensor.v1.quantizeParams.encodingDefinition = QNN_DEFINITION_DEFINED;
    tensor.v1.quantizeParams.quantizationEncoding = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    tensor.v1.quantizeParams.scaleOffsetEncoding = {0.125f, -128};
    tensor.v1.rank = 2;
    tensor.v1.dimensions = dimensions;
    tensor.v1.memType = QNN_TENSORMEMTYPE_RAW;
    if (kind == QNN_TENSOR_TYPE_STATIC) tensor.v1.clientBuf = {data, bytes};
    return tensor;
}

int main(int argc, char** argv) {
    if (argc != 3 || std::string(argv[2]) != "--export-context") {
        std::cerr << "Usage: qnn-smoke <report.json> --export-context; execute and validate with qnn_validate.py\n";
        return 2;
    }
    Json report = {
        {"kind", "qnn-htp-context-export"}, {"status", "fail"},
        {"backend", "qnn-htp"}, {"cpuFallback", false}, {"verified", false},
        {"model", "uint8-dense-matmul-32x64x64"}, {"tokensPerSecond", nullptr},
        {"scope", "Compiled context and independent expected outputs only; no inference validation is performed by this exporter."}
    };
    int exitCode = 1;
    try {
        const char* libraryRoot = std::getenv("QNN_LIB_PATH");
        if (!libraryRoot || !*libraryRoot) throw std::runtime_error("QNN_LIB_PATH is required");
        const auto libraryPath = std::filesystem::path(libraryRoot) / "libQnnHtp.so";
        Session session;
        session.library = dlopen(libraryPath.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (!session.library) throw std::runtime_error(std::string("Load libQnnHtp.so: ") + dlerror());
        auto getProviders = reinterpret_cast<decltype(&QnnInterface_getProviders)>(dlsym(session.library, "QnnInterface_getProviders"));
        if (!getProviders) throw std::runtime_error("QnnInterface_getProviders is missing");
        const QnnInterface_t** providers = nullptr;
        uint32_t providerCount = 0;
        check(getProviders(&providers, &providerCount), "QnnInterface_getProviders");
        const QnnInterface_t* provider = nullptr;
        for (uint32_t index = 0; index < providerCount; ++index) {
            if (providers[index]->backendId == QNN_BACKEND_ID_HTP &&
                providers[index]->apiVersion.coreApiVersion.major == QNN_API_VERSION_MAJOR &&
                providers[index]->apiVersion.coreApiVersion.minor >= QNN_API_VERSION_MINOR) {
                provider = providers[index];
                break;
            }
        }
        if (!provider) throw std::runtime_error("No compatible QNN HTP provider; CPU fallback is forbidden");
        session.api = provider->QNN_INTERFACE_VER_NAME;
        const auto version = provider->apiVersion.coreApiVersion;
        report["coreApiVersion"] = {{"major", version.major}, {"minor", version.minor}, {"patch", version.patch}};
        report["backendId"] = provider->backendId;
        report["library"] = libraryPath.string();
        std::ifstream socFile("/sys/devices/soc0/machine");
        std::string socName;
        std::getline(socFile, socName);
        report["soc"] = socName.empty() ? Json(nullptr) : Json(socName);
        check(session.api.logCreate(logMessage, QNN_LOG_LEVEL_ERROR, &session.log), "logCreate");
        check(session.api.backendCreate(session.log, nullptr, &session.backend), "backendCreate");
        check(session.api.deviceCreate(session.log, nullptr, &session.device), "deviceCreate");
        check(session.api.contextCreate(session.backend, session.device, nullptr, &session.context), "contextCreate");
        Qnn_GraphHandle_t graph = nullptr;
        check(session.api.graphCreate(session.context, "dense_u8_matmul", nullptr, &graph), "graphCreate");

        std::array<uint8_t, width * width> weights{};
        std::array<uint8_t, elements> input{};
        std::array<uint8_t, elements> output{};
        std::array<uint8_t, elements> expected{};
        for (uint32_t row = 0; row < width; ++row) {
            for (uint32_t column = 0; column < width; ++column) {
                weights[row * width + column] = static_cast<uint8_t>(128 + int((row * 17 + column * 13) % 5) - 2);
            }
        }
        uint32_t activationDimensions[] = {batch, width};
        uint32_t weightDimensions[] = {width, width};
        auto inputTensor = makeTensor("input", QNN_TENSOR_TYPE_APP_WRITE, activationDimensions, input.data(), input.size());
        auto weightTensor = makeTensor("weights", QNN_TENSOR_TYPE_STATIC, weightDimensions, weights.data(), weights.size());
        auto outputTensor = makeTensor("output", QNN_TENSOR_TYPE_APP_READ, activationDimensions, output.data(), output.size());
        check(session.api.tensorCreateGraphTensor(graph, &inputTensor), "create input tensor");
        check(session.api.tensorCreateGraphTensor(graph, &weightTensor), "create weight tensor");
        check(session.api.tensorCreateGraphTensor(graph, &outputTensor), "create output tensor");
        Qnn_Tensor_t nodeInputs[] = {inputTensor, weightTensor};
        Qnn_OpConfig_t operation = QNN_OPCONFIG_INIT;
        operation.v1.name = "dense_matmul";
        operation.v1.packageName = QNN_OP_PACKAGE_NAME_QTI_AISW;
        operation.v1.typeName = QNN_OP_MAT_MUL;
        operation.v1.numOfInputs = 2;
        operation.v1.inputTensors = nodeInputs;
        operation.v1.numOfOutputs = 1;
        operation.v1.outputTensors = &outputTensor;
        check(session.api.graphAddNode(graph, operation), "graphAddNode MatMul");
        check(session.api.graphFinalize(graph, nullptr, nullptr), "graphFinalize");
        inputTensor.v1.clientBuf = {input.data(), input.size()};
        outputTensor.v1.clientBuf = {output.data(), output.size()};
        Qnn_ContextBinarySize_t capacity = 0;
        Qnn_ContextBinarySize_t written = 0;
        check(session.api.contextGetBinarySize(session.context, &capacity), "contextGetBinarySize");
        if (capacity == 0 || capacity > 64 * 1024 * 1024) throw std::runtime_error("Unexpected context binary size");
        session.contextBinary.resize(capacity);
        check(session.api.contextGetBinary(session.context, session.contextBinary.data(), capacity, &written), "contextGetBinary");
        if (written == 0 || written > capacity) throw std::runtime_error("Invalid serialized context size");

        auto prepareFixture = [&](unsigned fixture) {
            for (uint32_t index = 0; index < elements; ++index) {
                input[index] = static_cast<uint8_t>(128 + 8 * (int((index + fixture) % 8) - 4));
            }
            for (uint32_t row = 0; row < batch; ++row) {
                for (uint32_t column = 0; column < width; ++column) {
                    int accumulator = 0;
                    for (uint32_t inner = 0; inner < width; ++inner) {
                        accumulator += (int(input[row * width + inner]) - 128) * (int(weights[inner * width + column]) - 128);
                    }
                    if (accumulator % 8 != 0) throw std::runtime_error("Fixture has an ambiguous requantization rounding case");
                    expected[row * width + column] = static_cast<uint8_t>(std::clamp(128 + accumulator / 8, 0, 255));
                }
            }
        };
        const auto prefix = std::filesystem::path(argv[1]).replace_extension().string();
        writeBytes(prefix + ".bin", session.contextBinary.data(), written);
        std::string inputList;
        report["fixtures"] = Json::array();
        for (unsigned fixture = 0; fixture < 8; ++fixture) {
            prepareFixture(fixture);
            const auto inputPath = prefix + ".input-" + std::to_string(fixture) + ".raw";
            const auto expectedPath = prefix + ".expected-" + std::to_string(fixture) + ".raw";
            writeBytes(inputPath, input.data(), input.size());
            writeBytes(expectedPath, expected.data(), expected.size());
            inputList += inputPath + "\n";
            report["fixtures"].push_back({{"input", inputPath}, {"expected", expectedPath}, {"values", elements}});
        }
        writeBytes(prefix + ".inputs.txt", inputList.data(), inputList.size());
        report["context"] = prefix + ".bin";
        report["inputList"] = prefix + ".inputs.txt";
        report["status"] = "exported";
        exitCode = 0;
    } catch (const std::exception& error) {
        report["error"] = error.what();
    }
    std::ofstream outputFile(argv[1]);
    if (!outputFile) {
        std::cerr << "Cannot write validation report\n";
        return 2;
    }
    outputFile << report.dump(2) << '\n';
    outputFile.close();
    if (!outputFile) return 2;
    std::cout << report.dump(2) << '\n';
    return exitCode;
}

#else

#include <cstdio>

int main() {
    std::fputs("This QNN HTP runner requires Linux ARM64 with QAIRT headers and libraries.\n", stderr);
    return 2;
}

#endif