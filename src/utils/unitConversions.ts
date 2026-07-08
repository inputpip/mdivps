import { ItemUnitConversion, UnitOption } from '@/types/unitConversion'

const parseDecimal = (raw: string): number => {
  const normalized = raw.trim().replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export const parseUnitConversionsText = (text: string): Array<{ unitName: string; conversionQty: number }> => {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [unitNameRaw, qtyRaw] = line.split('=')
      const unitName = unitNameRaw?.trim() || ''
      const conversionQty = parseDecimal(qtyRaw || '')
      return { unitName, conversionQty }
    })
    .filter((item) => item.unitName && item.conversionQty > 0)
}

export const serializeUnitConversionsText = (
  conversions: Array<Pick<ItemUnitConversion, 'unitName' | 'conversionQty'>>,
  baseUnit?: string,
): string => {
  return conversions
    .filter((item) => item.unitName && item.unitName !== baseUnit)
    .sort((a, b) => a.unitName.localeCompare(b.unitName))
    .map((item) => `${item.unitName}=${item.conversionQty}`)
    .join('\n')
}

export const buildUnitOptions = (
  baseUnit: string,
  conversions: Array<Pick<ItemUnitConversion, 'unitName' | 'conversionQty'>> = [],
): UnitOption[] => {
  const unique = new Map<string, UnitOption>()

  if (baseUnit) {
    unique.set(baseUnit, { unitName: baseUnit, conversionQty: 1, isBaseUnit: true })
  }

  for (const item of conversions) {
    if (!item.unitName || item.conversionQty <= 0) continue
    unique.set(item.unitName, {
      unitName: item.unitName,
      conversionQty: item.unitName === baseUnit ? 1 : item.conversionQty,
      isBaseUnit: item.unitName === baseUnit,
    })
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.isBaseUnit) return -1
    if (b.isBaseUnit) return 1
    return a.unitName.localeCompare(b.unitName)
  })
}

export const getBaseQuantity = (quantity: number, conversionQty: number): number => {
  const safeQuantity = Number(quantity) || 0
  const safeConversion = Number(conversionQty) || 1
  return Number((safeQuantity * safeConversion).toFixed(4))
}

export const formatUnitConversionPreview = (
  quantity: number,
  purchaseUnit: string,
  baseQuantity: number,
  baseUnit: string,
): string => {
  const qtyLabel = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(quantity || 0)
  const baseQtyLabel = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(baseQuantity || 0)

  if (!purchaseUnit || !baseUnit || purchaseUnit === baseUnit) {
    return `${qtyLabel} ${baseUnit}`
  }

  return `${qtyLabel} ${purchaseUnit} = ${baseQtyLabel} ${baseUnit}`
}
