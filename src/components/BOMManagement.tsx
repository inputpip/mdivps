"use client"

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Trash2, Plus } from 'lucide-react';
import { useMaterials } from '@/hooks/useMaterials';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { BOMItem } from '@/types/production';
import { updateProductCostFromBOM } from '@/hooks/useProducts';

interface BOMManagementProps {
  productId: string;
  productName: string;
}

const parseDecimalInput = (value: string): number => {
  const normalized = value.replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDecimalDisplay = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('id-ID', { maximumFractionDigits: 4 });
};

export function BOMManagement({ productId, productName }: BOMManagementProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [bom, setBom] = useState<BOMItem[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [quantityInput, setQuantityInput] = useState('1');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const quantity = parseDecimalInput(quantityInput);
  
  const { materials } = useMaterials();
  const { toast } = useToast();

  // Load BOM when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadBOM();
    }
  }, [isOpen, productId]);

  const loadBOM = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('product_materials')
        .select(`
          *,
          materials (name, unit)
        `)
        .eq('product_id', productId);

      if (error) throw error;

      const bomItems: BOMItem[] = data?.map(item => ({
        id: item.id,
        materialId: item.material_id,
        materialName: item.materials?.name || 'Unknown Material',
        quantity: item.quantity,
        unit: item.materials?.unit || 'pcs',
        notes: item.notes
      })) || [];

      setBom(bomItems);
    } catch (error: any) {
      console.error('Error loading BOM:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load Bill of Materials"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const addBOMItem = async () => {
    if (!selectedMaterialId || quantity <= 0) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please select a material and enter a valid quantity"
      });
      return;
    }

    try {
      setIsLoading(true);
      
      // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
      const { data: dataRaw, error } = await supabase
        .from('product_materials')
        .insert({
          product_id: productId,
          material_id: selectedMaterialId,
          quantity,
          notes: notes || null
        })
        .select(`
          *,
          materials (name, unit)
        `)
        .order('id', { ascending: false }).limit(1);
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;

      if (error) throw error;

      const newItem: BOMItem = {
        id: data.id,
        materialId: data.material_id,
        materialName: data.materials?.name || 'Unknown Material',
        quantity: data.quantity,
        unit: data.materials?.unit || 'pcs',
        notes: data.notes
      };

      setBom([...bom, newItem]);
      setSelectedMaterialId('');
      setQuantityInput('1');
      setNotes('');

      // Auto-update product cost_price from BOM
      await updateProductCostFromBOM(productId);

      toast({
        title: "Success",
        description: "Material added to BOM successfully"
      });
    } catch (error: any) {
      console.error('Error adding BOM item:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add material to BOM"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const removeBOMItem = async (bomItemId: string) => {
    try {
      setIsLoading(true);
      
      const { error } = await supabase
        .from('product_materials')
        .delete()
        .eq('id', bomItemId);

      if (error) throw error;

      setBom(bom.filter(item => item.id !== bomItemId));

      // Auto-update product cost_price from BOM
      await updateProductCostFromBOM(productId);

      toast({
        title: "Success",
        description: "Material removed from BOM successfully"
      });
    } catch (error: any) {
      console.error('Error removing BOM item:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to remove material from BOM"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const availableMaterials = materials?.filter(material => 
    !bom.some(bomItem => bomItem.materialId === material.id)
  ) || [];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Manage BOM
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bill of Materials - {productName}</DialogTitle>
          <DialogDescription>
            Kelola bahan baku yang dibutuhkan untuk memproduksi produk ini
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Add Material Section */}
          <div className="border-b pb-4">
            <h4 className="font-medium mb-3">Add Material</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label htmlFor="material-select">Material</Label>
                <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select material..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMaterials.map(material => (
                      <SelectItem key={material.id} value={material.id}>
                        {material.name} ({material.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  noFormat
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  placeholder="0"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Bisa isi desimal, contoh: 1,5 atau 1.5</p>
              </div>
              <div>
                <Label htmlFor="notes">Notes (optional)</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes..."
                />
              </div>
              <div className="flex items-end">
                <Button 
                  onClick={addBOMItem} 
                  disabled={isLoading || !selectedMaterialId || quantity <= 0}
                  className="w-full"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>
          </div>

          {/* BOM List */}
          <div>
            <h4 className="font-medium mb-3">Current BOM ({bom.length} items)</h4>
            {bom.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <h4 className="text-yellow-800 font-medium">BOM Kosong</h4>
                    <p className="text-yellow-700 text-sm mt-1">
                      Produk Produksi wajib memiliki BOM untuk dapat diproduksi. 
                      Tambahkan material di atas untuk melengkapi BOM.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2">Material</th>
                        <th className="text-left px-3 py-2">Unit</th>
                        <th className="text-left px-3 py-2">Quantity</th>
                        <th className="text-left px-3 py-2">Notes</th>
                        <th className="text-left px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bom.map(item => (
                        <tr key={item.id} className="border-t">
                          <td className="px-3 py-2">
                            <div className="font-medium">{item.materialName}</div>
                          </td>
                          <td className="px-3 py-2">{item.unit}</td>
                          <td className="px-3 py-2 font-medium">{formatDecimalDisplay(item.quantity)}</td>
                          <td className="px-3 py-2 text-gray-600">{item.notes || '-'}</td>
                          <td className="px-3 py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBOMItem(item.id)}
                              disabled={isLoading}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}