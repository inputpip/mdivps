"use client"
import * as React from "react"
import { TrendingUp, TrendingDown, Wallet, ChevronDown, ChevronUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

interface AccountBalance {
  accountId: string;
  accountName: string;
  currentBalance: number;
  previousBalance: number;
  todayIncome: number;
  todayExpense: number;
  todayTransferNet: number;
  todayNet: number;
  todayChange: number;
}

interface AccountBalanceTableProps {
  data: AccountBalance[];
  isLoading: boolean;
}

export function AccountBalanceTable({ data, isLoading }: AccountBalanceTableProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount)
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Saldo Per Akun Keuangan</CardTitle>
          <CardDescription>Memuat data saldo akun...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 dark:bg-slate-700 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Saldo Per Akun Keuangan
                </CardTitle>
                <CardDescription>
                  {data?.length || 0} akun • Total: {formatCurrency(data?.reduce((sum, account) => sum + account.currentBalance, 0) || 0)}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm">
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="text-sm font-medium text-blue-700 dark:text-blue-300">Total Saldo Saat Ini</div>
                <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                  {formatCurrency(data?.reduce((sum, account) => sum + account.currentBalance, 0) || 0)}
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-4">
                <div className="text-sm font-medium text-gray-700 dark:text-slate-300">Total Saldo Sebelumnya</div>
                <div className="text-xl font-bold text-gray-600 dark:text-slate-400">
                  {formatCurrency(data?.reduce((sum, account) => sum + account.previousBalance, 0) || 0)}
                </div>
              </div>

              <div className={`border rounded-lg p-4 ${
                (data?.reduce((sum, account) => sum + account.todayNet, 0) || 0) >= 0
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              }`}>
                <div className={`text-sm font-medium ${
                  (data?.reduce((sum, account) => sum + account.todayNet, 0) || 0) >= 0
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-red-700 dark:text-red-300'
                }`}>
                  Total Perubahan Hari Ini
                </div>
                <div className={`text-xl font-bold ${
                  (data?.reduce((sum, account) => sum + account.todayNet, 0) || 0) >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {formatCurrency(data?.reduce((sum, account) => sum + account.todayNet, 0) || 0)}
                </div>
              </div>
            </div>

            {/* Account Details */}
            <div className="space-y-3">
              {data?.map((account) => (
                <div key={account.accountId} className="border rounded-lg p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{account.accountName}</span>
                    </div>
                    <Badge variant={account.currentBalance >= 0 ? "default" : "destructive"} className="font-bold">
                      {formatCurrency(account.currentBalance)}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground mb-1">Saldo Sebelumnya</div>
                      <div className="font-medium text-gray-600 dark:text-slate-400">
                        {formatCurrency(account.previousBalance)}
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-muted-foreground mb-1">Masuk Hari Ini</div>
                      <div className={`font-medium ${account.todayIncome > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                        {account.todayIncome > 0 ? formatCurrency(account.todayIncome) : '-'}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-1">Keluar Hari Ini</div>
                      <div className={`font-medium ${account.todayExpense > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                        {account.todayExpense > 0 ? formatCurrency(account.todayExpense) : '-'}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-1">Setoran (Transfer)</div>
                      <div className={`font-medium flex items-center gap-1 ${
                        account.todayTransferNet > 0 ? 'text-blue-600 dark:text-blue-400' : account.todayTransferNet < 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'
                      }`}>
                        {account.todayTransferNet > 0 ? `+${formatCurrency(account.todayTransferNet)}` : account.todayTransferNet < 0 ? `-${formatCurrency(Math.abs(account.todayTransferNet))}` : '-'}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-1">Arus Kas Hari Ini</div>
                      <div className={`font-medium flex items-center gap-1 ${
                        account.todayNet >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {account.todayNet >= 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {formatCurrency(Math.abs(account.todayNet))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {(!data || data.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  Tidak ada data akun keuangan.
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}