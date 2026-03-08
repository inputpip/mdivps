import { useState, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExpenseManagement } from "@/components/ExpenseManagement"
import { EmployeeAdvanceManagement } from "@/components/EmployeeAdvanceManagement"
import { FileText, HandCoins } from "lucide-react"

export default function ExpensesAndAdvancesPage() {
    const location = useLocation()
    const navigate = useNavigate()

    // Decide active tab based on path
    const [activeTab, setActiveTab] = useState("expenses")

    useEffect(() => {
        if (location.pathname.includes("expenses")) {
            setActiveTab("expenses")
        } else if (location.pathname.includes("advances")) {
            setActiveTab("advances")
        }
    }, [location.pathname])

    const handleTabChange = (val: string) => {
        setActiveTab(val)
        if (val === "expenses") {
            navigate("/expenses")
        } else {
            navigate("/advances")
        }
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight">Pengeluaran & Kasbon</h1>
                <p className="text-muted-foreground mt-1 text-sm">Kelola pencatatan biaya dan panjar dana (kasbon) karyawan.</p>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="mb-6 grid w-full max-w-sm grid-cols-2">
                    <TabsTrigger value="expenses" className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Pengeluaran
                    </TabsTrigger>
                    <TabsTrigger value="advances" className="flex items-center gap-2">
                        <HandCoins className="h-4 w-4" />
                        Panjar Karyawan
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="expenses">
                    <ExpenseManagement />
                </TabsContent>
                <TabsContent value="advances">
                    <EmployeeAdvanceManagement />
                </TabsContent>
            </Tabs>
        </div>
    )
}
