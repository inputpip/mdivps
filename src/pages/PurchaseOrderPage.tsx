"use client"
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PurchaseOrderTable } from "@/components/PurchaseOrderTable";
import { CreatePurchaseOrderDialog } from "@/components/CreatePurchaseOrderDialog";
import { ReceiveGoodsTab } from "@/components/ReceiveGoodsTab";
import { QuickAddSupplierDialog } from "@/components/QuickAddSupplierDialog";

export default function PurchaseOrderPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-row items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground">
            Kelola permintaan pembelian dan penerimaan barang
          </p>
        </div>
        <div className="flex items-center gap-2">
          <QuickAddSupplierDialog />
          <CreatePurchaseOrderDialog />
        </div>
      </div>

      <Tabs defaultValue="orders" className="space-y-4">
        <TabsList>
          <TabsTrigger value="orders">Daftar PO</TabsTrigger>
          <TabsTrigger value="receive">Penerimaan Barang</TabsTrigger>
        </TabsList>
        
        <TabsContent value="orders">
          <Card>
            <CardHeader>
              <CardTitle>Purchase Orders (PO)</CardTitle>
              <CardDescription>
                Daftar permintaan pembelian bahan baku dari tim. Admin dapat menyetujui atau menolak permintaan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PurchaseOrderTable />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="receive">
          <ReceiveGoodsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}