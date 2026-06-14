import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, MapPin, Check } from 'lucide-react';
import { Browser } from '@capacitor/browser';

const SERVERS = [
  {
    id: 'matahari',
    name: 'Matahari Percetakan',
    url: 'https://matahari.aquvit.id',
    description: 'Server utama Matahari',
    icon: '🏭',
  },
];

export function ServerSelector() {
  const [selected, setSelected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelect = async (server: typeof SERVERS[0]) => {
    setSelected(server.id);
    setIsLoading(true);

    // Small delay for visual feedback
    setTimeout(async () => {
      try {
        // Open the server URL in Capacitor's in-app browser
        await Browser.open({
          url: server.url,
          presentationStyle: 'fullscreen',
          toolbarColor: '#1e40af'
        });
      } catch (e) {
        // Fallback: redirect in same window
        window.location.href = server.url;
      }
    }, 300);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Pilih Server Matahari</h1>
          <p className="text-gray-600 mt-2">Buka aplikasi percetakan Matahari</p>
        </div>

        <div className="space-y-4">
          {SERVERS.map((server) => (
            <Card
              key={server.id}
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
                selected === server.id
                  ? 'ring-2 ring-blue-500 bg-blue-50'
                  : 'hover:bg-gray-50'
              }`}
              onClick={() => handleSelect(server)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="text-4xl">{server.icon}</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-900">
                      {server.name}
                    </h3>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <MapPin className="w-3 h-3" />
                      {server.description}
                    </div>
                  </div>
                  {selected === server.id && (
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 mt-8">
          Buka server Matahari untuk melanjutkan
        </p>
      </div>
    </div>
  );
}

export default ServerSelector;
