export type HypoglycemiaLevel = 1 | 2

export type GlucoseClassification = {
  id: 'hypoglycemia-level-2' | 'hypoglycemia-level-1' | 'below-range' | 'in-range' | 'intermediate' | 'attention' | 'high-attention' | 'invalid'
  label: string
  color: string
  hypoglycemiaLevel?: HypoglycemiaLevel
}

export const classifyGlucose = (value: number): GlucoseClassification => {
  if (!Number.isFinite(value) || value < 0) return { id: 'invalid', label: 'Valor inválido', color: '#B9AFA8' }
  if (value < 54) return { id: 'hypoglycemia-level-2', label: 'Hipoglicemia nível 2 — Atenção alta', color: '#A93347', hypoglycemiaLevel: 2 }
  if (value < 70) return { id: 'hypoglycemia-level-1', label: 'Hipoglicemia nível 1', color: '#CE6872', hypoglycemiaLevel: 1 }
  if (value < 80) return { id: 'below-range', label: 'Abaixo da faixa definida', color: '#D5B45F' }
  if (value <= 130) return { id: 'in-range', label: 'Dentro da faixa definida', color: '#71AFA5' }
  if (value <= 170) return { id: 'intermediate', label: 'Intermediária', color: '#D5B45F' }
  if (value <= 299) return { id: 'attention', label: 'Atenção', color: '#D98A60' }
  return { id: 'high-attention', label: 'Atenção alta', color: '#CE6872' }
}

export const glucoseSummary = (values: number[]) => {
  if (!values.length) return undefined
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return { minimum, maximum, average }
}

export const hypoglycemiaGuidance = (classification: GlucoseClassification) => {
  if (classification.hypoglycemiaLevel === 2) return 'Atenção alta: siga agora seu plano individual de tratamento da hipoglicemia.'
  if (classification.hypoglycemiaLevel === 1) return 'Siga seu plano individual de tratamento da hipoglicemia.'
  return undefined
}
