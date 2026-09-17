import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { DistrictDef } from '../core/types'
import { fmtNum, fmtPct } from '../core/util'

/**
 * Every district, defined once. The 3D world reads `pos`/`color` to place and
 * tint itself; the HUD legend, guided tour and inspector read the copy and the
 * live `readout`. Nothing re-derives a position or a colour anywhere else.
 *
 * Layout (top-down): VTCM shared memory sits at the centre with the three fused
 * accelerators around it — scalar to the north, HVX vector to the west, HMX
 * tensor to the east — micro-tile inferencing to the south, and the rest of the
 * heterogeneous AI Engine (Oryon CPU, Adreno GPU) and the sensing hub on the
 * corners.
 */
export const DISTRICTS: DistrictDef[] = [
  {
    id: 'vtcm',
    name: 'VTCM · shared memory',
    subtitle: 'Vector Tightly-Coupled Memory',
    color: COLOR.vtcm,
    pos: new THREE.Vector3(0, 0, 0),
    blurb:
      'NPU-local, software-managed memory used to keep working tiles close to ' +
      'the compute engines. Reusing resident data can reduce system-memory ' +
      'traffic, but transfers to and from DRAM are still needed. This diagram ' +
      'does not imply a CPU/GPU-shared cache or a physical bus topology.',
    readout: (s) => `occupancy ${fmtPct(s.vtcmOccupancy)} · ${fmtNum(s.microTiles, 0)} live tiles`,
  },
  {
    id: 'scalar',
    name: 'Scalar accelerator',
    subtitle: 'Control flow & orchestration',
    color: COLOR.scalar,
    pos: new THREE.Vector3(0, 0, -26),
    blurb:
      'Runs the control flow of the model: sequencing layers, handling branches ' +
      'and the parts of a network that are not large matrix math. It orchestrates ' +
      'the vector and tensor engines and keeps them fed from VTCM.',
    readout: (s) => `utilisation ${fmtPct(s.util.scalar)}`,
  },
  {
    id: 'vector',
    name: 'HVX · vector engine',
    subtitle: 'Hexagon Vector eXtensions (SIMD)',
    color: COLOR.vector,
    pos: new THREE.Vector3(-26, 0, 0),
    blurb:
      'A wide SIMD vector unit. It does the per-element work that sits between ' +
      'matrix multiplies — activation functions, normalisation, elementwise adds ' +
      'and pooling — streaming lanes of data in parallel.',
    readout: (s) => `utilisation ${fmtPct(s.util.vector)}`,
  },
  {
    id: 'tensor',
    name: 'HMX · tensor engine',
    subtitle: 'Hexagon Matrix eXtensions (MAC array)',
    color: COLOR.tensor,
    pos: new THREE.Vector3(26, 0, 0),
    blurb:
      'The tensor accelerator: a large multiply-accumulate array purpose-built ' +
      'for convolutions, fully-connected layers and transformer matmuls. Most of ' +
      "the NPU's TOPS live here, which is why it dominates on vision and LLM work.",
    readout: (s) => `${fmtNum(s.tops)} TOPS · ${fmtPct(s.util.tensor)} busy · ${s.precision}`,
  },
  {
    id: 'microtile',
    name: 'Micro-tile scheduling',
    subtitle: 'Scheduling concept, not a separate accelerator',
    color: COLOR.microtile,
    pos: new THREE.Vector3(0, 0, 26),
    blurb:
      'Tiling divides a larger tensor operation into smaller pieces that fit ' +
      'local memory and can reuse data. This district visualizes that scheduling ' +
      'idea; it is not an extra silicon block. Tile counts and the animated ' +
      'sequence are illustrative, not compiler traces.',
    readout: (s) => `${fmtNum(s.microTiles, 0)} tiles streaming`,
  },
  {
    id: 'cpu',
    name: 'Host CPU',
    subtitle: 'System context, outside the NPU',
    color: COLOR.cpu,
    pos: new THREE.Vector3(-25, 0, -25),
    blurb:
      'The host CPU can prepare inputs, submit inference work and process ' +
      'outputs. CPU architecture depends on the Snapdragon generation; Oryon ' +
      'is not present in every Hexagon-based device. This block is system ' +
      'context, not part of the Hexagon NPU.',
    readout: (s) => `dispatching ${s.workload === 'idle' ? 'idle' : 'the NPU'}`,
  },
  {
    id: 'gpu',
    name: 'Qualcomm Adreno GPU',
    subtitle: 'System context, outside the NPU',
    color: COLOR.gpu,
    pos: new THREE.Vector3(25, 0, -25),
    blurb:
      'The GPU is another compute option in the broader Qualcomm AI Engine. ' +
      'Execution and data transfers depend on the runtime and supported ' +
      'operators. It is outside the NPU and should not be read as a direct ' +
      'consumer of the VTCM pool shown here.',
    readout: () => 'system context / not simulated',
  },
  {
    id: 'sensors',
    name: 'Sensing hub',
    subtitle: 'System context, outside the NPU',
    color: COLOR.sensors,
    pos: new THREE.Vector3(-25, 0, 25),
    blurb:
      'Low-power sensing can handle always-on tasks without continuously ' +
      'running the main compute engines. Its capabilities vary by device. ' +
      'It is shown for system context; the power readout is a toy NPU model, ' +
      'not a sensing-hub or whole-device measurement.',
    readout: () => 'system context / not simulated',
  },
]

const BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]))

export function districtById(id: string): DistrictDef | undefined {
  return BY_ID.get(id as DistrictDef['id'])
}
