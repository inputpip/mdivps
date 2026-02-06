"use client"

import * as React from "react"
import { format, setHours, setMinutes, setDate, setMonth, setYear } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "./input"
import { Label } from "./label"
import { ToggleGroup, ToggleGroupItem } from "./toggle-group"

interface DateTimePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function DateTimePicker({ date, setDate, disabled = false, placeholder = "Pilih tanggal & waktu" }: DateTimePickerProps) {
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(date);
  const [hour, setHour] = React.useState(date ? parseInt(format(date, "hh"), 10) : 12);
  const [minute, setMinute] = React.useState(date ? date.getMinutes() : 0);
  const [amPm, setAmPm] = React.useState<'AM' | 'PM'>(date ? format(date, "aa") as 'AM' | 'PM' : "AM");

  React.useEffect(() => {
    if (date) {
      setSelectedDate(date);
      setHour(parseInt(format(date, "hh"), 10));
      setMinute(date.getMinutes());
      setAmPm(format(date, "aa") as 'AM' | 'PM');
    }
  }, [date]);

  const combineDateTime = (d: Date, h: number, m: number, ap: 'AM' | 'PM'): Date => {
    let newHour = h;
    if (ap === 'PM' && h < 12) newHour += 12;
    if (ap === 'AM' && h === 12) newHour = 0; // Midnight case
    return setMinutes(setHours(d, newHour), m);
  };

  const updateDateTime = (newDatePart: Partial<{ day: Date, h: number, m: number, ap: 'AM' | 'PM' }>) => {
    const currentDay = newDatePart.day || selectedDate || new Date();
    const currentHour = newDatePart.h ?? hour;
    const currentMinute = newDatePart.m ?? minute;
    const currentAmPm = newDatePart.ap ?? amPm;

    const finalDate = combineDateTime(currentDay, currentHour, currentMinute, currentAmPm);
    setSelectedDate(finalDate);
    setDate(finalDate);
  };

  const handleDateSelect = (day: Date | undefined) => {
    if (!day) {
      setDate(undefined);
      setSelectedDate(undefined);
      return;
    }
    updateDateTime({ day });
  }

  const handleHourChange = (value: number) => {
    if (value >= 1 && value <= 12) {
      setHour(value);
      updateDateTime({ h: value });
    }
  }

  const handleMinuteChange = (value: number) => {
    if (value >= 0 && value < 60) {
      setMinute(value);
      updateDateTime({ m: value });
    }
  }

  const handleAmPmChange = (value: 'AM' | 'PM') => {
    if (value) {
      setAmPm(value);
      updateDateTime({ ap: value });
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal h-9",
            !date && "text-muted-foreground"
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "dd/MM/yyyy hh:mm aa") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          initialFocus
        />
        <div className="p-3 border-t border-border">
          <div className="flex items-end gap-2">
            <div className="grid gap-1 text-center">
              <Label htmlFor="hours" className="text-xs">Jam</Label>
              <Input
                id="hours"
                type="number"
                className="w-[48px] h-8"
                value={String(hour).padStart(2, '0')}
                onChange={(e) => handleHourChange(parseInt(e.target.value, 10))}
                min="1"
                max="12"
              />
            </div>
            <div className="grid gap-1 text-center">
              <Label htmlFor="minutes" className="text-xs">Menit</Label>
              <Input
                id="minutes"
                type="number"
                className="w-[48px] h-8"
                value={String(minute).padStart(2, '0')}
                onChange={(e) => handleMinuteChange(parseInt(e.target.value, 10))}
                min="0"
                max="59"
              />
            </div>
            <div className="grid gap-1 text-center">
              <Label className="text-xs">&nbsp;</Label>
              <ToggleGroup
                type="single"
                value={amPm}
                onValueChange={handleAmPmChange}
                className="h-8"
              >
                <ToggleGroupItem value="AM" className="px-2 h-full text-xs">AM</ToggleGroupItem>
                <ToggleGroupItem value="PM" className="px-2 h-full text-xs">PM</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}