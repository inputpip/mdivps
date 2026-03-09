import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'

export interface CompanyInfo {
  name: string;
  companyName?: string; // Alias for name
  address: string;
  phone: string;
  email?: string; // Company email
  logo: string;
  npwp?: string; // Nomor Pokok Wajib Pajak
  latitude?: number | null;
  longitude?: number | null;
  attendanceRadius?: number | null;
  timezone?: string; // e.g., 'Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'
  // Bank accounts for invoice
  bankAccount1?: string; // e.g., "MANDIRI-1540020855197"
  bankAccountName1?: string; // Nama pemilik rekening 1
  bankAccount2?: string; // e.g., "BNI-2990213245"
  bankAccountName2?: string; // Nama pemilik rekening 2
  bankAccount3?: string; // e.g., "BRI-777201000033304"
  bankAccountName3?: string; // Nama pemilik rekening 3
  salesPhone?: string; // Nomor HP Sales
  // Thermal printer settings
  thermalPrinterWidth?: '58mm' | '80mm'; // Ukuran kertas thermal (58mm atau 80mm)
  // Telegram Bot settings
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramEnabled?: boolean;
}

export const useCompanySettings = () => {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<CompanyInfo>({
    queryKey: ['companySettings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_settings').select('key, value');
      if (error) throw new Error(error.message);

      const settingsObj = data.reduce((acc, { key, value }) => {
        acc[key] = value;
        return acc;
      }, {} as any);

      const settings = {
        name: settingsObj.company_name || '',
        address: settingsObj.company_address || '',
        phone: settingsObj.company_phone || '',
        logo: settingsObj.company_logo || '',
        npwp: settingsObj.company_npwp || '',
        latitude: settingsObj.company_latitude ? parseFloat(settingsObj.company_latitude) : null,
        longitude: settingsObj.company_longitude ? parseFloat(settingsObj.company_longitude) : null,
        attendanceRadius: settingsObj.company_attendance_radius ? parseInt(settingsObj.company_attendance_radius, 10) : null,
        timezone: settingsObj.company_timezone || 'Asia/Jakarta', // Default WIB
        bankAccount1: settingsObj.company_bank_account_1 || '',
        bankAccountName1: settingsObj.company_bank_account_name_1 || '',
        bankAccount2: settingsObj.company_bank_account_2 || '',
        bankAccountName2: settingsObj.company_bank_account_name_2 || '',
        bankAccount3: settingsObj.company_bank_account_3 || '',
        bankAccountName3: settingsObj.company_bank_account_name_3 || '',
        salesPhone: settingsObj.company_sales_phone || '',
        thermalPrinterWidth: (settingsObj.thermal_printer_width as '58mm' | '80mm') || '58mm',
        telegramBotToken: settingsObj.telegram_bot_token || '',
        telegramChatId: settingsObj.telegram_chat_id || '',
        telegramEnabled: settingsObj.telegram_enabled === 'true',
      };

      // Cache logo for early loading screens (like APK server selector)
      if (settings.logo) {
        localStorage.setItem('company_logo_cached', settings.logo);
      }

      return settings;
    },
    staleTime: 60 * 60 * 1000, // 1 hour (settings rarely change)
    gcTime: 2 * 60 * 60 * 1000, // 2 hours cache
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const updateSettings = useMutation({
    mutationFn: async (newInfo: CompanyInfo) => {
      const settingsData = [
        { key: 'company_name', value: newInfo.name },
        { key: 'company_address', value: newInfo.address },
        { key: 'company_phone', value: newInfo.phone },
        { key: 'company_logo', value: newInfo.logo },
        { key: 'company_npwp', value: newInfo.npwp || '' },
        { key: 'company_latitude', value: newInfo.latitude?.toString() ?? '' },
        { key: 'company_longitude', value: newInfo.longitude?.toString() ?? '' },
        { key: 'company_attendance_radius', value: newInfo.attendanceRadius?.toString() ?? '' },
        { key: 'company_timezone', value: newInfo.timezone || 'Asia/Jakarta' },
        { key: 'company_bank_account_1', value: newInfo.bankAccount1 || '' },
        { key: 'company_bank_account_name_1', value: newInfo.bankAccountName1 || '' },
        { key: 'company_bank_account_2', value: newInfo.bankAccount2 || '' },
        { key: 'company_bank_account_name_2', value: newInfo.bankAccountName2 || '' },
        { key: 'company_bank_account_3', value: newInfo.bankAccount3 || '' },
        { key: 'company_bank_account_name_3', value: newInfo.bankAccountName3 || '' },
        { key: 'company_sales_phone', value: newInfo.salesPhone || '' },
        { key: 'thermal_printer_width', value: newInfo.thermalPrinterWidth || '58mm' },
        { key: 'telegram_bot_token', value: newInfo.telegramBotToken || '' },
        { key: 'telegram_chat_id', value: newInfo.telegramChatId || '' },
        { key: 'telegram_enabled', value: newInfo.telegramEnabled ? 'true' : 'false' },
      ];
      const { error } = await supabase.from('company_settings').upsert(settingsData);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companySettings'] });
    }
  });

  return { settings, isLoading, updateSettings };
}