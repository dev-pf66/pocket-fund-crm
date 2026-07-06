import { stageMeta } from '../lib/stages'

// Small colored pill for a pipeline stage. Uses the shared stage palette so
// the same stage reads identically across LeadDetail, the Dashboard alerts,
// and anywhere else a stage is shown as a label.
export default function StageChip({ stage }) {
  if (!stage) return null
  const { label, color } = stageMeta(stage)
  return (
    <span className="stage-chip" style={{ '--chip': color }}>{label}</span>
  )
}
