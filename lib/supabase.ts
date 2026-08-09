import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";
import { createLocalDemoSupabaseClient } from "./local-demo/client";
import { installLocalDemoNetworkGuard } from "./local-demo/network-guard";

export const IS_LOCAL_DEMO =
  Platform.OS === "web" &&
  process.env.EXPO_PUBLIC_FINFLOW_LOCAL_DEMO === "true";

if (IS_LOCAL_DEMO) installLocalDemoNetworkGuard();

/**
 * Tokens de sessão não podem permanecer em texto puro no AsyncStorage nativo.
 * O fallback web existe porque navegadores não expõem Keychain/Keystore. Ao
 * atualizar uma instalação antiga, a primeira leitura migra o token legado e
 * remove a cópia desprotegida sem obrigar o usuário a entrar novamente.
 */
const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return AsyncStorage.getItem(key);
    const secured = await SecureStore.getItemAsync(key);
    if (secured !== null) return secured;
    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null) {
      await SecureStore.setItemAsync(key, legacy, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      await AsyncStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.removeItem(key);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS !== "web") await SecureStore.deleteItemAsync(key);
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
