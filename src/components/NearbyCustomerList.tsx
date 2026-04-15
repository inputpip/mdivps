"use client"

import { useMemo, useState, useEffect } from 'react'
import { format, differenceInDays } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import { Customer } from '@/types/customer'
import { sortCustomersByDistance, filterByRadius } from '@/utils/geoUtils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Phone, Navigation, Store, Home, MapPin, AlertCircle, ShoppingCart, Eye, EyeOff, FileText, UserCheck, Clock3 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SalesVisitDialog } from '@/components/SalesVisitDialog'
import { useAuth } from '@/hooks/useAuth'
import {
  getVisitedCustomerIdsAsync,
  cleanExpiredVisits,
  getTodayVisitCountAsync
} from '@/utils/customerVisitUtils'
import { useBranch } from '@/contexts/BranchContext'
import { PhotoUploadService } from '@/services/photoUploadService'
import { useGranularPermission } from '@/hooks/useGranularPermission'

interface NearbyCustomerListProps {
  customers: Customer[]
  userLocation: { lat: number; lng: number } | null
  radiusMeters: number
  onRadiusChange: (radius: number) => void
  onCustomerSelect?: (customer: Customer) => void
}

const RADIUS_OPTIONS = [
  { value: 500, label: '500 m' },
  { value: 1000, label: '1 km' },
  { value: 2000, label: '2 km' },
  { value: 5000, label: '5 km' },
  { value: 10000, label: '10 km' },
  { value: 999999, label: 'Semua' },
]

const getLastOrderInfo = (lastOrderDate?: Date | string | null) => {
  if (!lastOrderDate) {
    return {
      label: 'Belum pernah order',
      sublabel: 'Belum ada transaksi',
      colorClass: 'text-muted-foreground'
    }
  }

  const parsedDate = lastOrderDate instanceof Date ? lastOrderDate : new Date(lastOrderDate)

  if (Number.isNaN(parsedDate.getTime())) {
    return {
      label: 'Tanggal tidak valid',
      sublabel: 'Cek data transaksi',
      colorClass: 'text-orange-600 dark:text-orange-400'
    }
  }

  const daysSinceLastOrder = differenceInDays(new Date(), parsedDate)
  const formattedDate = format(parsedDate, 'd MMM yyyy', { locale: idLocale })

  let colorClass = 'text-emerald-600 dark:text-emerald-400'
  if (daysSinceLastOrder > 90) {
    colorClass = 'text-red-600 dark:text-red-400'
  } else if (daysSinceLastOrder > 60) {
    colorClass = 'text-orange-600 dark:text-orange-400'
  } else if (daysSinceLastOrder > 30) {
    colorClass = 'text-amber-600 dark:text-amber-400'
  }

  return {
    label: formattedDate,
    sublabel: daysSinceLastOrder === 0 ? 'Hari ini' : `${daysSinceLastOrder} hari lalu`,
    colorClass
  }
}

export function NearbyCustomerList({
  customers,
  userLocation,
  radiusMeters,
  onRadiusChange,
  onCustomerSelect
}: NearbyCustomerListProps) {
  const navigate = useNavigate()
  const { hasGranularPermission } = useGranularPermission()
  const { currentBranch } = useBranch()

  const { user } = useAuth()

  // Check permissions
  const canAccessDriverPos = hasGranularPermission('pos_driver_access')
  const canAccessQuotations = hasGranularPermission('quotations_create')

  // Check if user is sales or owner
  const isSalesOrOwner = user?.role?.toLowerCase() === 'owner' ||
    user?.role?.toLowerCase() === 'sales' ||
    user?.role?.toLowerCase() === 'admin'

  // State for sales visit dialog
  const [visitDialogOpen, setVisitDialogOpen] = useState(false)
  const [selectedCustomerForVisit, setSelectedCustomerForVisit] = useState<Customer | null>(null)

  // State untuk hide visited customers
  const [hideVisited, setHideVisited] = useState(true)
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set())
  const [visitCount, setVisitCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  // Load visited customers from DATABASE on mount
  useEffect(() => {
    const loadVisits = async () => {
      setIsLoading(true)
      cleanExpiredVisits()

      // Load from database (shared across all drivers)
      const dbVisitedIds = await getVisitedCustomerIdsAsync(currentBranch?.id)
      setVisitedIds(dbVisitedIds)

      const dbVisitCount = await getTodayVisitCountAsync(currentBranch?.id)
      setVisitCount(dbVisitCount)

      setIsLoading(false)
    }

    loadVisits()

    // Refresh every 30 seconds to get updates from other drivers
    const interval = setInterval(loadVisits, 30000)
    return () => clearInterval(interval)
  }, [currentBranch?.id])

  // Sort and filter customers by distance
  const nearbyCustomers = useMemo(() => {
    if (!userLocation) return []

    const sorted = sortCustomersByDistance(
      customers,
      userLocation.lat,
      userLocation.lng
    )

    let filtered = filterByRadius(sorted, radiusMeters)

    // Filter out visited customers if hideVisited is true
    if (hideVisited) {
      filtered = filtered.filter(c => !visitedIds.has(c.id))
    }

    return filtered
  }, [customers, userLocation, radiusMeters, hideVisited, visitedIds])

  const handleOpenMaps = (customer: Customer) => {
    if (userLocation) {
      // Open with directions from user location
      window.open(
        `https://www.google.com/maps/dir/${userLocation.lat},${userLocation.lng}/${customer.latitude},${customer.longitude}`,
        '_blank'
      )
    } else {
      window.open(
        `https://www.google.com/maps/dir//${customer.latitude},${customer.longitude}`,
        '_blank'
      )
    }
  }

  const handleCall = (phone: string) => {
    window.location.href = `tel:${phone}`
  }

  const handleOpenDriverPos = (customer: Customer) => {
    navigate(`/driver-pos?customerId=${customer.id}`)
  }

  const handleOpenQuotation = (customer: Customer) => {
    navigate(`/quotations/new?customerId=${customer.id}`)
  }

  const handleOpenVisitDialog = (customer: Customer) => {
    setSelectedCustomerForVisit(customer)
    setVisitDialogOpen(true)
  }

  const handleVisitRecorded = async () => {
    // Reload visited customers after recording a visit
    const dbVisitedIds = await getVisitedCustomerIdsAsync(currentBranch?.id)
    setVisitedIds(dbVisitedIds)
    const dbVisitCount = await getTodayVisitCountAsync(currentBranch?.id)
    setVisitCount(dbVisitCount)
  }

  if (!userLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-12 w-12 text-orange-500 mb-4" />
        <h3 className="font-semibold text-lg mb-2">Lokasi Tidak Tersedia</h3>
        <p className="text-muted-foreground text-sm max-w-xs">
          Aktifkan GPS untuk melihat pelanggan terdekat dari lokasi Anda
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Radius Filter */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Radius:</span>
        </div>
        <Select
          value={radiusMeters.toString()}
          onValueChange={v => onRadiusChange(Number(v))}
        >
          <SelectTrigger className="w-28 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RADIUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value.toString()}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Hide visited toggle */}
      <div className="flex items-center justify-between px-1 py-2 bg-muted/50 dark:bg-slate-800/50 rounded-lg">
        <div className="flex items-center gap-2">
          {hideVisited ? (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Eye className="h-4 w-4 text-muted-foreground" />
          )}
          <Label htmlFor="hide-visited" className="text-sm cursor-pointer">
            Sembunyikan yang sudah dikunjungi
          </Label>
          {visitCount > 0 && (
            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
              {visitCount} dikunjungi
            </Badge>
          )}
        </div>
        <Switch
          id="hide-visited"
          checked={hideVisited}
          onCheckedChange={setHideVisited}
        />
      </div>

      {/* Results count */}
      <div className="px-1">
        <Badge variant="secondary">
          {nearbyCustomers.length} pelanggan ditemukan
        </Badge>
      </div>

      {/* Customer List */}
      {nearbyCustomers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Tidak ada pelanggan dalam radius {radiusMeters >= 1000 ? `${radiusMeters/1000} km` : `${radiusMeters} m`}</p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto pb-4" style={{ maxHeight: 'calc(100vh - 20rem)' }}>
          {nearbyCustomers.map((customer, index) => {
            const isKiosk = customer.classification === 'Kios/Toko'
            const lastOrderInfo = getLastOrderInfo(customer.lastOrderDate)

            return (
              <Card
                key={customer.id}
                className="cursor-pointer hover:shadow-md transition-shadow dark:bg-slate-800/50"
                onClick={() => onCustomerSelect?.(customer as Customer)}
              >
                <CardContent className="p-3">
                  {/* Top row: Photo, Name, Distance, Rank */}
                  <div className="flex gap-3 items-start">
                    {/* Photo or Icon */}
                    <div className="flex-shrink-0">
                      {customer.store_photo_url ? (
                        <img
                          src={PhotoUploadService.getPhotoUrl(customer.store_photo_url, 'Customers_Images')}
                          alt={customer.name}
                          className="w-14 h-14 object-cover rounded-lg"
                        />
                      ) : (
                        <div className={`w-14 h-14 rounded-lg flex items-center justify-center ${
                          isKiosk ? 'bg-green-100 dark:bg-green-900/50' : 'bg-blue-100 dark:bg-blue-900/50'
                        }`}>
                          {isKiosk ? (
                            <Store className="h-6 w-6 text-green-600 dark:text-green-400" />
                          ) : (
                            <Home className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <h4 className="font-semibold text-sm truncate dark:text-white">
                          {customer.name}
                        </h4>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Badge
                            variant="outline"
                            className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700 text-xs"
                          >
                            {customer.distanceFormatted}
                          </Badge>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            index === 0
                              ? 'bg-yellow-400 text-yellow-900'
                              : index === 1
                              ? 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
                              : index === 2
                              ? 'bg-orange-300 text-orange-800'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {index + 1}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {customer.address}
                      </p>
                      {/* Classification */}
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            isKiosk
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                          }`}
                        >
                          {customer.classification || 'Umum'}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {customer.orderCount || 0} order
                        </Badge>
                      </div>

                      <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/50 px-2 py-1.5 dark:bg-slate-700/40">
                        <Clock3 className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-[11px] text-muted-foreground">Order terakhir</p>
                          <p className="text-xs font-medium dark:text-white">{lastOrderInfo.label}</p>
                          <p className={`text-[11px] ${lastOrderInfo.colorClass}`}>{lastOrderInfo.sublabel}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom row: Actions */}
                  <div className="flex flex-col gap-2 mt-2">
                    {/* Row 1: POS, Quotation, Visit */}
                    <div className="flex gap-1 flex-wrap">
                      {canAccessDriverPos && (
                        <Button
                          size="sm"
                          className="h-8 px-3 text-xs bg-green-600 hover:bg-green-700"
                          onClick={e => {
                            e.stopPropagation()
                            handleOpenDriverPos(customer as Customer)
                          }}
                        >
                          <ShoppingCart className="h-3 w-3 mr-1" />
                          POS
                        </Button>
                      )}
                      {canAccessQuotations && (
                        <Button
                          size="sm"
                          className="h-8 px-3 text-xs bg-purple-600 hover:bg-purple-700"
                          onClick={e => {
                            e.stopPropagation()
                            handleOpenQuotation(customer as Customer)
                          }}
                        >
                          <FileText className="h-3 w-3 mr-1" />
                          Penawaran
                        </Button>
                      )}
                      {isSalesOrOwner && (
                        <Button
                          size="sm"
                          className="h-8 px-3 text-xs bg-cyan-600 hover:bg-cyan-700"
                          onClick={e => {
                            e.stopPropagation()
                            handleOpenVisitDialog(customer as Customer)
                          }}
                        >
                          <UserCheck className="h-3 w-3 mr-1" />
                          Dikunjungi
                        </Button>
                      )}
                    </div>
                    {/* Row 2: Call, Navigate */}
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 text-xs dark:border-slate-600"
                        onClick={e => {
                          e.stopPropagation()
                          handleCall(customer.phone)
                        }}
                      >
                        <Phone className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 text-xs dark:border-slate-600"
                        onClick={e => {
                          e.stopPropagation()
                          handleOpenMaps(customer as Customer)
                        }}
                      >
                        <Navigation className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Sales Visit Dialog */}
      <SalesVisitDialog
        open={visitDialogOpen}
        onOpenChange={setVisitDialogOpen}
        customer={selectedCustomerForVisit}
        onVisitRecorded={handleVisitRecorded}
      />
    </div>
  )
}
