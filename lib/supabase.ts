import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";
import { createLocalDemoSupabaseClient } from "./local-demo/client";
import { installLocalDemoNetworkGuard } from "./local-demo/network-guard";

export const IS_LOCAL_DEMO =
  Platform.OS === "web" &&
  process.env.EXPO_PUBLIC_FINFLOW_LOCAL_DEMO === "true";

if (IS_LOCAL_DEMO) installLocalDemoNetworkGuard();

type SecureStoreOptions = {
  keychainAccessible?: number;
};

type ExpoSecureStoreNativeModule = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: number;
  getValueWithKeyAsync(key: string, options: SecureStoreOptions): Promise<string | null>;
  setValueWithKeyAsync(
    value: string,
    key: string,
    options: SecureStoreOptions,
  ): Promise<void>;
  deleteValueWithKeyAsync(key: string, options: SecureStoreOptions): Promise<void>;
};

/**
 * O primeiro APK 2.0 não incluía expo-secure-store no binário nativo. A
 * detecção opcional permite que ele receba atualizações OTA sem falhar no
 * carregamento; builds novos continuam usando Keychain/Keystore normalmente.
 */
const nativeSecureStore =
  Platform.OS === "web"
    ? null
    : requireOptionalNativeModule<ExpoSecureStoreNativeModule>("ExpoSecureStore");

const secureStoreOptions: SecureStoreOptions =
  nativeSecureStore?.WHEN_UNLOCKED_THIS_DEVICE_ONLY === undefined
    ? {}
    : {
        keychainAccessible: nativeSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      };

/**
 * Builds que possuem o módulo nativo guardam a sessão no Keychain/Keystore. O
 * fallback web e de compatibilidade do APK 2.0 usa o armazenamento legado. Na
 * primeira abertura de um build novo, a sessão é migrada automaticamente para
 * o cofre nativo sem obrigar o usuário a entrar novamente.
 */
const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!nativeSecureStore) return AsyncStorage.getItem(key);
    const secured = await nativeSecureStore.getValueWithKeyAsync(
      key,
      secureStoreOptions,
    );
    if (secured !== null) return secured;
    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null) {
      await nativeSecureStore.setValueWithKeyAsync(
        legacy,
        key,
        secureStoreOptions,
      );
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!nativeSecureStore) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    await nativeSecureStore.setValueWithKeyAsync(
      value,
      key,
      secureStoreOptions,
    );
    await AsyncStorage.removeItem(key);
  },
  async removeItem(key: string): Promise<void> {
    if (nativeSecureStore) {
      await nativeSecureStore.deleteValueWithKeyAsync(key, secureStoreOptions);
    }
    await AsyncStorage.removeItem(key);
  },
};

function createConfiguredClient(): SupabaseClient {
  if (IS_LOCAL_DEMO) {
    return createLocalDemoSupabaseClient() as unknown as SupabaseClient;
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("As variaveis EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY sao obrigatorias.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export const supabase = createConfiguredClient();
