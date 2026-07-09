import { useState, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MaterialManagement } from "@/components/MaterialManagement"
import { ProductManagement } from "@/components/ProductManagement"
import { UnitConversionManagement } from "@/components/UnitConversionManagement"
import { Package, Box, Scale } from "lucide-react"

export default function MasterDataStockPage() {
    const location = useLocation()
    const navigate = useNavigate()

    // Decide active tab based on path
    const [activeTab, setActiveTab] = useState("materials")

    useEffect(() => {
        if (location.pathname.includes("unit-conversions")) {
            setActiveTab("unit-conversions")
        } else if (location.pathname.includes("materials")) {
            setActiveTab("materials")
        } else if (location.pathname.includes("products")) {
            setActiveTab("products")
        }
    }, [location.pathname])

    const handleTabChange = (val: string) => {
        setActiveTab(val)
        if (val === "materials") {
            navigate("/materials")
        } else if (val === "products") {
            navigate("/products")
        } else {
            navigate("/unit-conversions")
        }
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight">Data Barang & Stok</h1>
                <p className="text-muted-foreground mt-1 text-sm">Kelola informasi bahan baku, produk, BOM, serta memantau persediaan.</p>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="mb-6 grid w-full max-w-2xl grid-cols-3">
                    <TabsTrigger value="materials" className="flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Bahan Baku
                    </TabsTrigger>
                    <TabsTrigger value="products" className="flex items-center gap-2">
                        <Box className="h-4 w-4" />
                        Produk FG
                    </TabsTrigger>
                    <TabsTrigger value="unit-conversions" className="flex items-center gap-2">
                        <Scale className="h-4 w-4" />
                        Konversi Satuan
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="materials">
                    <MaterialManagement />
                </TabsContent>
                <TabsContent value="products">
                    <ProductManagement />
                </TabsContent>
                <TabsContent value="unit-conversions">
                    <UnitConversionManagement />
                </TabsContent>
            </Tabs>
        </div>
    )
}
