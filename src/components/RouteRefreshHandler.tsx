import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

/**
 * RouteRefreshHandler
 * Komponen ini berfungsi untuk memantau perubahan rute (URL)
 * dan memicu penyegaran data (refetch) pada React Query secara otomatis.
 */
export function RouteRefreshHandler() {
    const location = useLocation();
    const queryClient = useQueryClient();

    useEffect(() => {
        // 1. Invalidate semua query agar React Query melakukan refetch halus di background
        // pada komponen yang sedang di-render di halaman baru.
        queryClient.invalidateQueries();

        // 2. Scroll ke posisi atas (Opsional, agar user tidak bingung saat pindah halaman panjang)
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });

        console.log(`[AutoRefresh] Navigated to ${location.pathname}, triggering query invalidation...`);
    }, [location.pathname, location.search, queryClient]);

    return null;
}
