export interface ExtractedCharacterInfo {
  height?: string
  weight?: string
  age?: string
  birthday?: string
  father?: string
  mother?: string
  siblings?: string
  origin?: string
  abilities?: string
  affiliations?: string
}

const FIELD_PATTERNS: Array<{ key: keyof ExtractedCharacterInfo; patterns: RegExp[] }> = [
  { key: 'height', patterns: [/\bheight\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bheight\s+is\s+([^\n;.]+)[\n;.]/i] },
  { key: 'weight', patterns: [/\bweight\b[:\-\s]*([^\n;.]+)[\n;.]/i] },
  { key: 'age', patterns: [/\bage\b[:\-\s]*([^\n;.]+)[\n;.]/i] },
  { key: 'birthday', patterns: [/\bbirthday\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bborn\b[:\-\s]*([^\n;.]+)[\n;.]/i] },
  { key: 'father', patterns: [/\bfather\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bson\s+of\b\s*([^\n;.]+)[\n;.]/i] },
  { key: 'mother', patterns: [/\bmother\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bdaughter\s+of\b\s*([^\n;.]+)[\n;.]/i] },
  { key: 'siblings', patterns: [/\bsibling[s]?\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bbrother[s]?\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bsister[s]?\b[:\-\s]*([^\n;.]+)[\n;.]/i] },
  { key: 'origin', patterns: [/\borigin\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bfrom\b\s+([^\n;.]+)[\n;.]/i] },
  { key: 'abilities', patterns: [/\babilit(y|ies)\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bpower[s]?\b[:\-\s]*([^\n;.]+)[\n;.]/i] },
  { key: 'affiliations', patterns: [/\baffiliation[s]?\b[:\-\s]*([^\n;.]+)[\n;.]/i, /\bmember\s+of\b\s*([^\n;.]+)[\n;.]/i] },
]

export function extractCharacterInfo(description: string | undefined | null): ExtractedCharacterInfo {
  const text = (description || '').replace(/\r/g, '\n') + '\n.' // sentinel to simplify regex end
  const info: ExtractedCharacterInfo = {}
  if (!text.trim()) return info

  for (const field of FIELD_PATTERNS) {
    for (const pat of field.patterns) {
      const m = text.match(pat)
      if (m && m[1]) {
        const value = m[1].trim().replace(/\s+/g, ' ')
        ;(info as any)[field.key] = value
        break
      }
    }
  }
  return info
}


