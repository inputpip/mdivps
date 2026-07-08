import { useState } from 'react';
import { Plus, Building2, MapPin, Phone, Mail, User, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useBranches } from '@/hooks/useBranches';
import { Branch } from '@/types/branch';

// Default company ID yang sudah dibuat di migration
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export default function BranchManagementPage() {
  const { branches, isLoading, createBranch, updateBranch, deleteBranch } = useBranches();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [formData, setFormData] = useState({
    companyId: DEFAULT_COMPANY_ID,
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    managerId: '',
    managerName: '',
    isActive: true,
  });

  const handleOpenDialog = (branch?: Branch) => {
    if (branch) {
      setEditingBranch(branch);
      setFormData({
        companyId: branch.companyId,
        name: branch.name,
        code: branch.code,
        address: branch.address || '',
        phone: branch.phone || '',
        email: branch.email || '',
        managerId: branch.managerId || '',
        managerName: branch.managerName || '',
        isActive: branch.isActive,
      });
    } else {
      setEditingBranch(null);
      setFormData({
        companyId: DEFAULT_COMPANY_ID,
        name: '',
        code: '',
        address: '',
        phone: '',
        email: '',
        managerId: '',
        managerName: '',
        isActive: true,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    // Clean up empty strings to null for UUID fields
    const cleanedData = {
      ...formData,
      managerId: formData.managerId.trim() === '' ? null : formData.managerId,
      address: formData.address.trim() === '' ? null : formData.address,
      phone: formData.phone.trim() === '' ? null : formData.phone,
      email: formData.email.trim() === '' ? null : formData.email,
      managerName: formData.managerName.trim() === '' ? null : formData.managerName,
    };

    if (editingBranch) {
      await updateBranch.mutateAsync({
        id: editingBranch.id,
        updates: cleanedData,
      });
    } else {
      await createBranch.mutateAsync(cleanedData as any);
    }
    setIsDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Apakah Anda yakin ingin menghapus cabang ini?')) {
      await deleteBranch.mutateAsync(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Manajemen Cabang</h2>
          <p className="text-sm text-muted-foreground">Kelola cabang perusahaan Anda</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4 mr-2" />
          Tambah Cabang
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama Cabang</TableHead>
              <TableHead>Alamat</TableHead>
              <TableHead>Kontak</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.map((branch) => (
              <TableRow key={branch.id}>
                <TableCell className="font-mono">{branch.code}</TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    {branch.name}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {branch.address && (
                      <>
                        <MapPin className="w-3 h-3" />
                        {branch.address}
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1 text-sm">
                    {branch.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        {branch.phone}
                      </div>
                    )}
                    {branch.email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="w-3 h-3" />
                        {branch.email}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {branch.managerName && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-3 h-3 text-muted-foreground" />
                      {branch.managerName}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={branch.isActive ? 'default' : 'secondary'}>
                    {branch.isActive ? 'Aktif' : 'Tidak Aktif'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenDialog(branch)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(branch.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingBranch ? 'Edit Cabang' : 'Tambah Cabang Baru'}
            </DialogTitle>
            <DialogDescription>
              {editingBranch
                ? 'Perbarui informasi cabang'
                : 'Tambahkan cabang baru ke sistem'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Kode Cabang</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="PUSAT, JKT, SBY, dll"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Nama Cabang</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Kantor Pusat, Cabang Jakarta, dll"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Alamat</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Alamat lengkap cabang"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Telepon</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="081234567890"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="cabang@aquvit.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="managerName">Nama Manager</Label>
              <Input
                id="managerName"
                value={formData.managerName}
                onChange={(e) =>
                  setFormData({ ...formData, managerName: e.target.value })
                }
                placeholder="Nama manager cabang"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isActive: checked })
                }
              />
              <Label htmlFor="isActive">Cabang Aktif</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSubmit}>
              {editingBranch ? 'Simpan Perubahan' : 'Tambah Cabang'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
