import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, createElement, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { parthDark, parthLight } from './parthPalette';

function palette(theme: typeof parthLight | typeof parthDark) {
  return {
    canvas: theme.canvas, surface: theme.surface, surfaceMuted: theme.soft, surfaceRaised: theme.raised,
    ink: theme.panel, text: theme.text, muted: theme.muted, subtle: theme.subtle,
    border: theme.border, borderSoft: theme.border, brand: theme.brand, link: theme.link, onBrand: theme.onBrand,
    copper: theme.brand, copperSoft: theme.brandSoft, accent: theme.brand, accentSoft: theme.brandSoft,
    sky: theme.brand, skySoft: theme.brandSoft,
    success: theme.success, successSoft: theme.successSoft, warning: theme.warning, warningSoft: theme.warningSoft,
    danger: theme.danger, dangerSoft: theme.dangerSoft,
    panelText: theme.panelText, panelMuted: theme.panelMuted, panelSubtle: theme.panelMuted, panelAccent: '#AFC0FF',
    overlayFaint: 'rgba(255,255,255,0.08)', overlaySubtle: 'rgba(255,255,255,0.10)',
  };
}
export const lightColors = palette(parthLight);
export const darkColors: typeof lightColors = palette(parthDark);

export type AppColorScheme = 'light' | 'dark';
export type ThemePreference = 'system' | AppColorScheme;
export type AppColors = typeof lightColors;

const THEME_STORAGE_KEY = 'kothari.theme';

type ThemeContextValue = {
  colors: AppColors;
  isDark: boolean;
  scheme: AppColorScheme;
  setThemePreference: (preference: ThemePreference) => void;
  themeOptions: Array<{ label: string; value: ThemePreference }>;
  themePreference: ThemePreference;
};

const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function getColors(scheme: AppColorScheme) {
  return scheme === 'dark' ? darkColors : lightColors;
}

export function AppThemeProvider({ children }: PropsWithChildren) {
  const deviceScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const systemScheme: AppColorScheme = deviceScheme === 'dark' ? 'dark' : 'light';
  const scheme: AppColorScheme = themePreference === 'system' ? systemScheme : themePreference;
  const colors = getColors(scheme);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((value) => {
        if (value === 'system' || value === 'light' || value === 'dark') setThemePreferenceState(value);
      })
      .catch(() => undefined);
  }, []);

  function setThemePreference(nextPreference: ThemePreference) {
    setThemePreferenceState(nextPreference);
    AsyncStorage.setItem(THEME_STORAGE_KEY, nextPreference).catch(() => undefined);
  }

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      isDark: scheme === 'dark',
      scheme,
      setThemePreference,
      themeOptions,
      themePreference,
    }),
    [colors, scheme, themePreference],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useAppTheme() {
  const deviceScheme = useColorScheme();
  const context = useContext(ThemeContext);

  if (context) return context;

  const scheme: AppColorScheme = deviceScheme === 'dark' ? 'dark' : 'light';

  return {
    colors: getColors(scheme),
    isDark: scheme === 'dark',
    scheme,
    setThemePreference: () => undefined,
    themeOptions,
    themePreference: 'system' as ThemePreference,
  };
}

export const colors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
};

export const shadow = {
  card: {
    elevation: 1,
    shadowColor: colors.ink,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
  },
  dock: {
    elevation: 6,
    shadowColor: colors.ink,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
};

export const typography = {
  weight: {
    medium: '500' as const,
    bold: '700' as const,
    black: '700' as const,
  },
};
