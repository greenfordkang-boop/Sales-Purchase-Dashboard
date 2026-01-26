
import { useState, useEffect, useCallback } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  salesService,
  revenueService,
  purchaseService,
  inventoryService,
  crService,
  rfqService,
  syncAllDataToSupabase,
  loadAllDataFromSupabase
} from '../services/supabaseService';

// Generic hook for data that syncs with Supabase
export function useSupabaseSync<T>(
  localStorageKey: string,
  getInitialData: () => T,
  service?: { getAll: () => Promise<T>; saveAll: (data: T) => Promise<void> }
) {
  const [data, setData] = useState<T>(getInitialData);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Save to localStorage and Supabase
  const saveData = useCallback(async (newData: T) => {
    setData(newData);
    localStorage.setItem(localStorageKey, JSON.stringify(newData));

    if (isSupabaseConfigured() && service) {
      try {
        setIsSyncing(true);
        await service.saveAll(newData);
        setLastSyncTime(new Date());
        setSyncError(null);
      } catch (error: any) {
        setSyncError(error.message);
        console.error(`Failed to sync ${localStorageKey} to Supabase:`, error);
      } finally {
        setIsSyncing(false);
      }
    }
  }, [localStorageKey, service]);

  // Load from Supabase on mount if configured
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (isSupabaseConfigured() && service) {
        try {
          setIsSyncing(true);
          const supabaseData = await service.getAll();
          if (supabaseData && (Array.isArray(supabaseData) ? supabaseData.length > 0 : Object.keys(supabaseData).length > 0)) {
            setData(supabaseData);
            localStorage.setItem(localStorageKey, JSON.stringify(supabaseData));
          }
          setLastSyncTime(new Date());
        } catch (error: any) {
          setSyncError(error.message);
          console.error(`Failed to load ${localStorageKey} from Supabase:`, error);
        } finally {
          setIsSyncing(false);
        }
      }
    };

    loadFromSupabase();
  }, [localStorageKey, service]);

  return { data, setData: saveData, isSyncing, lastSyncTime, syncError };
}

// Hook for global sync status
export function useGlobalSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isConfigured] = useState(isSupabaseConfigured());

  const syncToCloud = useCallback(async () => {
    setIsSyncing(true);
    setSyncMessage('클라우드로 동기화 중...');

    const result = await syncAllDataToSupabase();

    setSyncMessage(result.message);
    setIsSyncing(false);

    setTimeout(() => setSyncMessage(null), 3000);
    return result;
  }, []);

  const loadFromCloud = useCallback(async () => {
    setIsSyncing(true);
    setSyncMessage('클라우드에서 데이터 로드 중...');

    const result = await loadAllDataFromSupabase();

    setSyncMessage(result.message);
    setIsSyncing(false);

    // Reload the page to reflect changes
    if (result.success) {
      setTimeout(() => window.location.reload(), 1500);
    } else {
      setTimeout(() => setSyncMessage(null), 3000);
    }

    return result;
  }, []);

  return { isSyncing, syncMessage, isConfigured, syncToCloud, loadFromCloud };
}
