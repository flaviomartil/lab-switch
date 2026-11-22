export interface Toggle {
  enabled: boolean
  invalid: boolean
}

export function resolveToggle(raw: string | undefined): Toggle {
  const value = raw?.trim().toLowerCase()
  return {
    enabled: value === '1' || value === 'on',
    invalid: value !== undefined && value !== '' && value !== '0' && value !== '1' && value !== 'on',
  }
}
