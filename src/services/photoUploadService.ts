// Frontend service untuk upload foto ke VPS server
export interface PhotoUploadResult {
  id: string;
  name: string;
  webViewLink: string;
  filename?: string;
  category?: string;
}

// Default VPS settings - now using HTTPS with domain
const DEFAULT_UPLOAD_URL = 'https://upload.aquvit.id';
const VPS_SETTINGS_KEY = 'aquvit_vps_settings';

// Helper to get VPS settings from localStorage
function getVPSConfig(): { baseUrl: string } {
  try {
    const saved = localStorage.getItem(VPS_SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Support legacy format (serverUrl + port) or new format (baseUrl)
      if (parsed.baseUrl) {
        return { baseUrl: parsed.baseUrl };
      } else if (parsed.serverUrl) {
        // Legacy format - convert to new format
        const port = parsed.port || '3001';
        return { baseUrl: `http://${parsed.serverUrl}:${port}` };
      }
    }
  } catch (error) {
    console.warn('Failed to load VPS settings from localStorage:', error);
  }
  return { baseUrl: DEFAULT_UPLOAD_URL };
}

export class PhotoUploadService {
  /**
   * Get the base VPS URL from settings
   */
  private static getBaseUrl(): string {
    const config = getVPSConfig();
    return config.baseUrl;
  }

  /**
   * Get the files URL
   */
  private static getFilesUrl(): string {
    return `${this.getBaseUrl()}/files`;
  }

  /**
   * Get the upload endpoint URL
   */
  private static getUploadUrl(): string {
    return `${this.getBaseUrl()}/upload`;
  }

  /**
   * Update VPS configuration (called from settings page)
   * @param baseUrlOrUrl - Full base URL or server IP/domain
   * @param port - Optional port (if first arg is just IP/domain)
   */
  static updateConfig(baseUrlOrUrl: string, port?: string): void {
    try {
      let baseUrl = baseUrlOrUrl;

      // If it looks like an IP or domain without protocol, add http://
      if (baseUrl && !baseUrl.startsWith('http')) {
        baseUrl = `http://${baseUrl}`;
        if (port) {
          baseUrl = `${baseUrl}:${port}`;
        }
      } else if (baseUrl && port && !baseUrl.includes(':', baseUrl.indexOf('//') + 2)) {
        // If it has protocol but no port, and port is provided
        baseUrl = `${baseUrl}:${port}`;
      }

      localStorage.setItem(VPS_SETTINGS_KEY, JSON.stringify({ baseUrl }));
      console.log(`VPS config updated: ${baseUrl}`);
    } catch (error) {
      console.error('Failed to update VPS config:', error);
    }
  }

  /**
   * Upload foto pelanggan ke VPS server
   * @param file - File foto yang akan diupload
   * @param customerName - Nama pelanggan untuk penamaan file
   * @param category - Kategori folder (default: Customers_Images)
   * @returns Promise dengan result upload
   */
  static async uploadPhoto(file: File, customerName: string, category: string = 'customers', enableExactName: boolean = false): Promise<PhotoUploadResult> {
    try {
      const formData = new FormData();

      let filename = '';
      let extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      if (file.type === 'image/jpeg') extension = 'jpg';

      if (enableExactName) {
        // Biarkan spasi dan huruf besar/kecil asli, hanya hapus karakter berbahaya (selain titik, dash, underscore, spasi)
        const cleanName = customerName.replace(/[^\w\s.-]/gi, '');
        filename = `${cleanName}.${extension}`;
      } else {
        // Format jadul (legacy): ubah spasi jadi dash, lowercase, tambah timestamp
        const cleanName = customerName.replace(/[^\w\s-]/gi, '').replace(/\s+/g, '-').toLowerCase();
        const timestamp = Date.now();
        filename = `${cleanName}-${timestamp}.${extension}`;
      }

      // Append fields BEFORE file (Best Practice for Multer/Busboy)
      formData.append('category', category);
      formData.append('filename', filename);
      formData.append('file', file);

      const uploadUrl = this.getUploadUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // Increased timeout to 60s

      let response: Response;
      try {
        response = await fetch(uploadUrl, {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('Upload timeout - koneksi terlalu lama');
        }
        throw new Error(`Network error: ${fetchError.message}`);
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Upload failed: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Upload failed');
      }

      // Use URL returned by VPS if available
      let fileUrl: string;
      let finalFilename: string;

      if (result.url) {
        fileUrl = result.url;
        finalFilename = result.filename || result.url.split('/').pop() || filename;
      } else if (result.filename) {
        finalFilename = result.filename;
        fileUrl = `${this.getFilesUrl()}/${category}/${finalFilename}`;
      } else {
        finalFilename = filename;
        fileUrl = `${this.getFilesUrl()}/${category}/${finalFilename}`;
      }

      return {
        id: finalFilename,
        name: finalFilename,
        webViewLink: fileUrl,
        filename: finalFilename,
        category: category
      };

    } catch (error: any) {
      throw new Error(`Photo upload failed: ${error.message}`);
    }
  }

  /**
   * Get photo URL from VPS
   * @param filename - Nama file foto (hanya filename, tanpa path)
   * @param category - Kategori folder (customers, deliveries, dll)
   * @returns URL foto lengkap
   */
  static getPhotoUrl(filename: string, category: string = 'customers'): string {
    if (!filename) return '';

    // Jika sudah berupa URL lengkap, kembalikan apa adanya
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      return filename;
    }

    // Jika filename mengandung path (legacy data), ambil hanya filename-nya
    if (filename.includes('/')) {
      const parts = filename.split('/');
      filename = parts[parts.length - 1];
    }

    // Normalize category name - map legacy names to actual VPS folder names
    const categoryMap: Record<string, string> = {
      'Customers_Images': 'customers',
      'Customers': 'customers',
      'Customer_Images': 'customers'
    };
    const normalizedCategory = categoryMap[category] || category;

    // Generate URL: baseUrl/files/category/filename
    return `${this.getFilesUrl()}/${normalizedCategory}/${filename}`;
  }

  /**
   * Check if VPS upload service is available
   * @returns Promise<boolean> - true if service is available
   */
  static async isServiceAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.warn('VPS photo upload service not available:', error);
      return false;
    }
  }

  /**
   * Delete photo from VPS
   * @param filename - Nama file foto
   * @param category - Kategori folder
   * @returns Promise<boolean>
   */
  static async deletePhoto(filename: string, category: string = 'customers'): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/files/${category}/${filename}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (error) {
      console.error('Failed to delete photo:', error);
      return false;
    }
  }

  /**
   * Get current VPS configuration
   * @returns Current VPS URL configuration
   */
  static getCurrentConfig(): { baseUrl: string; filesUrl: string } {
    return {
      baseUrl: this.getBaseUrl(),
      filesUrl: this.getFilesUrl()
    };
  }
}
