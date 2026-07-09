import { supabase } from '@/integrations/supabase/client'
import { ItemUnitConversion, UnitConversionItemType } from '@/types/unitConversion'

type DbRow = {
  id: string
  item_type: UnitConversionItemType
  item_id: string
  unit_name: string
  conversion_qty: number
  created_at: string
  updated_at: string
}

const fromDb = (row: DbRow): ItemUnitConversion => ({
  id: row.id,
  itemType: row.item_type,
  itemId: row.item_id,
  unitName: row.unit_name,
  conversionQty: Number(row.conversion_qty) || 0,
  createdAt: row.created_at ? new Date(row.created_at) : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
})

export async function listItemUnitConversions(params: {
  itemType?: UnitConversionItemType
  itemIds?: string[]
} = {}): Promise<ItemUnitConversion[]> {
  let query = (supabase as any)
    .from('item_unit_conversions')
    .select('*')
    .order('unit_name', { ascending: true })

  if (params.itemType) {
    query = query.eq('item_type', params.itemType)
  }

  if (params.itemIds && params.itemIds.length > 0) {
    query = query.in('item_id', params.itemIds)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row: any) => fromDb(row as DbRow))
}

export async function replaceItemUnitConversions(params: {
  itemType: UnitConversionItemType
  itemId: string
  conversions: Array<{ unitName: string; conversionQty: number }>
}): Promise<void> {
  const { itemType, itemId, conversions } = params

  const { error: deleteError } = await (supabase as any)
    .from('item_unit_conversions')
    .delete()
    .eq('item_type', itemType)
    .eq('item_id', itemId)

  if (deleteError) throw deleteError

  if (conversions.length === 0) return

  const payload = conversions.map((item) => ({
    item_type: itemType,
    item_id: itemId,
    unit_name: item.unitName,
    conversion_qty: item.conversionQty,
  }))

  const { error: insertError } = await (supabase as any).from('item_unit_conversions').insert(payload)
  if (insertError) throw insertError
}

export function groupItemUnitConversions(conversions: ItemUnitConversion[]): Record<string, ItemUnitConversion[]> {
  return conversions.reduce<Record<string, ItemUnitConversion[]>>((acc, item) => {
    const key = `${item.itemType}:${item.itemId}`
    acc[key] = acc[key] || []
    acc[key].push(item)
    return acc
  }, {})
}
