export type UnitConversionItemType = 'material' | 'product'

export interface ItemUnitConversion {
  id?: string
  itemType: UnitConversionItemType
  itemId: string
  unitName: string
  conversionQty: number
  createdAt?: Date
  updatedAt?: Date
}

export interface UnitOption {
  unitName: string
  conversionQty: number
  isBaseUnit: boolean
}
