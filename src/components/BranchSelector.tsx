import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useBranch } from '@/contexts/BranchContext';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';

export function BranchSelector() {
  const {
    currentBranch,
    availableBranches,
    canAccessAllBranches,
    switchBranch,
    isHeadOffice,
  } = useBranch();
  const [open, setOpen] = useState(false);

  // Tampilkan selector jika ada lebih dari 1 cabang yang bisa diakses
  if (availableBranches.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
        <Building2 className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{currentBranch?.name || 'N/A'}</span>
        {isHeadOffice && (
          <Badge variant="secondary" className="text-xs">
            Head Office
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[250px] justify-between"
        >
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            <span className="truncate">
              {currentBranch?.name || 'Pilih cabang...'}
            </span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0">
        <Command>
          <CommandInput placeholder="Cari cabang..." />
          <CommandEmpty>Cabang tidak ditemukan.</CommandEmpty>
          <CommandGroup>
            {availableBranches.map((branch) => (
              <CommandItem
                key={branch.id}
                value={branch.id}
                onSelect={(value) => {
                  switchBranch(value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    currentBranch?.id === branch.id ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div className="flex flex-col">
                  <span className="font-medium">{branch.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {branch.code}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
