"use client"

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Customer } from '@/types/customer'
import { calculateDistance, formatDistance } from '@/utils/geoUtils'
import { Button } from '@/components/ui/button'
import { Phone, Navigation, Store, Home, ShoppingCart } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// Fix Leaflet default marker icon issue
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

L.Marker.prototype.options.icon = DefaultIcon

// Custom marker icons
const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      background-color: ${color};
      width: 24px;
      height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  })
}

const kioskIcon = createCustomIcon('#22c55e') // green
const homeIcon = createCustomIcon('#3b82f6') // blue
const userIcon = L.divIcon({
  className: 'user-marker',
  html: `<div style="
    background-color: #ef4444;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 0 0 3px rgba(239,68,68,0.3), 0 2px 4px rgba(0,0,0,0.3);
    animation: pulse 2s infinite;
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

interface CustomerMapProps {
  customers: Customer[]
  userLocation: { lat: number; lng: number } | null
  onCustomerClick?: (customer: Customer) => void
  selectedCustomerId?: string
}

// Component to fit bounds
function FitBounds({
  customers,
  userLocation
}: {
  customers: Customer[]
  userLocation: { lat: number; lng: number } | null
}) {
  const map = useMap()

  useEffect(() => {
    const points: [number, number][] = []

    // Add user location
    if (userLocation) {
      points.push([userLocation.lat, userLocation.lng])
    }

    // Add customer locations
    customers.forEach(c => {
      if (c.latitude && c.longitude) {
        points.push([c.latitude, c.longitude])
      }
    })

    if (points.length > 0) {
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    }
  }, [customers, userLocation, map])

  return null
}

// Component to center on user
function CenterOnUser({
  userLocation
}: {
  userLocation: { lat: number; lng: number } | null
}) {
  const map = useMap()

  useEffect(() => {
    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 14)
    }
  }, [userLocation, map])

  return null
}

export function CustomerMap({
  customers,
  userLocation,
  onCustomerClick,
  selectedCustomerId
}: CustomerMapProps) {
  // Filter customers with valid coordinates
  const customersWithCoords = useMemo(() => {
    return customers.filter(c => c.latitude && c.longitude)
  }, [customers])

  // Default center (Papua/Nabire area if no user location)
  const defaultCenter: [number, number] = userLocation
    ? [userLocation.lat, userLocation.lng]
    : [-3.3636, 135.4969] // Nabire

  const handleOpenMaps = (customer: Customer) => {
    window.open(
      `https://www.google.com/maps/dir//${customer.latitude},${customer.longitude}`,
      '_blank'
    )
  }

  const handleCall = (phone: string) => {
    window.location.href = `tel:${phone}`
  }

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        className="w-full h-full"
        style={{ minHeight: '400px' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Fit bounds to show all markers */}
        {customersWithCoords.length > 0 && (
          <FitBounds customers={customersWithCoords} userLocation={userLocation} />
        )}

        {/* User location marker */}
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup>
              <div className="text-center">
                <strong>Lokasi Anda</strong>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Customer markers */}
        {customersWithCoords.map(customer => {
          const isKiosk = customer.classification === 'Kios/Toko'
          const markerIcon = isKiosk ? kioskIcon : homeIcon
          const distance = userLocation
            ? calculateDistance(
              userLocation.lat,
              userLocation.lng,
              customer.latitude!,
              customer.longitude!
            )
            : null

          return (
            <Marker
              key={customer.id}
              position={[customer.latitude!, customer.longitude!]}
              icon={markerIcon}
              eventHandlers={{
                click: () => onCustomerClick?.(customer)
              }}
            >
              <Popup minWidth={200} maxWidth={280}>
                <div className="space-y-2">
                  {/* Photo */}
                  {customer.store_photo_url && (
                    <img
                      src={customer.store_photo_url}
                      alt={customer.name}
                      className="w-full h-24 object-cover rounded"
                    />
                  )}

                  {/* Name & Classification */}
                  <div className="flex items-center gap-2">
                    {isKiosk ? (
                      <Store className="h-4 w-4 text-green-600" />
                    ) : (
                      <Home className="h-4 w-4 text-blue-600" />
                    )}
                    <span className="font-semibold">{customer.name}</span>
                  </div>

                  {/* Address */}
                  <p className="text-sm text-gray-600">{customer.address}</p>

                  {/* Distance */}
                  {distance && (
                    <p className="text-sm font-medium text-orange-600">
                      Jarak: {formatDistance(distance)}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleCall(customer.phone)}
                    >
                      <Phone className="h-3 w-3 mr-1" />
                      Telp
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => handleOpenMaps(customer)}
                    >
                      <Navigation className="h-3 w-3 mr-1" />
                      Rute
                    </Button>
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-2 shadow-lg z-[1000]">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            <span>Rumahan</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span>Kios/Toko</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
            <span>Anda</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-lg z-[1000]">
        <span className="text-xs text-gray-600">
          {customersWithCoords.length} pelanggan di peta
        </span>
      </div>
    </div>
  )
}
