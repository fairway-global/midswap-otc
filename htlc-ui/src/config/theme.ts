/**
 * Design system — KAAMOS OTC.
 *
 *   Brand tokens (derived from the KAAMOS aurora logo):
 *     #000000  background                          (pure black — night sky)
 *     #FFFFFF  primary text / lines / icons        (white-as-primary)
 *     #8A8A8A  secondary / muted                   (ghost lines)
 *     #2DD4BF  Teal — main accent                  (active states, CTA, links)
 *     #7C3AED  Aurora Violet — subtle glow only    (background atmosphere)
 *     #06B6D4  Cyan — hover/bridge highlight        (cross-chain transitions)
 *
 *   The dominant chrome is BLACK + WHITE. Teal is used for active states,
 *   buttons, and interactive highlights. Violet/purple ONLY appears as
 *   very faint background glows to evoke the aurora/night-sky atmosphere.
 *   Never used in foreground text or UI chrome.
 *
 *   Radii: 6 inputs / 8 cards / 999 pills.
 *   Fonts: Inter for hero h1–h3 + panel titles; JetBrains Mono everywhere else.
 *
 * Every legacy `theme.custom.*` key is preserved as an alias so existing
 * call-sites (Header, SwapCard, MainLayout, WalletMenu, etc.) keep working
 * without per-file edits.
 */

import { createTheme, alpha, type ThemeOptions } from '@mui/material';

declare module '@mui/material/styles' {
  interface Theme {
    custom: {
      // ── Brand tokens ────────────────────────────────────────
      bg: string;
      midnightIndigo: string;
      cardanoBlue: string;
      deepViolet: string;
      bridgeCyan: string;
      teal: string;
      borderSubtle: string;
      borderStrong: string;
      textPrimary: string;
      textSecondary: string;
      textMuted: string;
      success: string;
      warning: string;
      danger: string;
      // ── Legacy aliases (read by Header/SwapCard/MainLayout/etc.) ──
      surface0: string;
      surface1: string;
      surface2: string;
      surface3: string;
      accent: string;
      accentSoft: string;
      accentGradient: string;
      midnightGlow: string;
      terminalGreen: string;
      terminalRed: string;
    };
  }
  interface ThemeOptions {
    custom?: Partial<Theme['custom']>;
  }
  interface Palette {
    surface: Palette['primary'];
  }
  interface PaletteOptions {
    surface?: PaletteOptions['primary'];
  }
}

// Brand palette — KAAMOS night sky
const bg = '#000000';
const teal = '#2DD4BF';            // Primary accent — teal from the aurora
const auroraViolet = '#7C3AED';    // Glow-only — never used in foreground
const deepViolet = '#1E1B4B';      // Depth glow
const bridgeCyan = '#06B6D4';      // Cross-chain highlight

// Legacy aliases — now mapped to teal-based palette
const midnightIndigo = teal;       // Active states now use teal
const cardanoBlue = teal;          // Chain affinity now uses teal

const textPrimary = '#FFFFFF';
const textSecondary = '#8A8A8A';
const textMuted = alpha('#FFFFFF', 0.35);

const borderSubtle = alpha('#FFFFFF', 0.08);
const borderStrong = alpha('#FFFFFF', 0.16);

const success = '#22C55E';
const warning = '#F59E0B';
const danger = '#EF4444';

const terminalGreen = '#39FF14';
const terminalRed = '#FF3B3B';

// Surfaces — pure black; depth comes from borders only
const surface0 = bg;
const surface1 = bg;
const surface2 = alpha('#FFFFFF', 0.03);
const surface3 = alpha('#FFFFFF', 0.06);

// Teal gradient for CTA
const accentGradient = `linear-gradient(135deg, ${teal} 0%, ${bridgeCyan} 100%)`;

// Very subtle aurora atmosphere — teal top glow, violet bottom corner
// These are barely-visible to give the night sky depth without
// making the background look "blue" or "AI-startup"
const midnightGlow = [
  `radial-gradient(circle at 50% -10%, ${alpha(teal, 0.04)} 0%, transparent 55%)`,
  `radial-gradient(circle at 95% 110%, ${alpha(auroraViolet, 0.03)} 0%, transparent 50%)`,
  `radial-gradient(circle at 5% 105%, ${alpha(deepViolet, 0.06)} 0%, transparent 45%)`,
].join(', ');

const monoStack =
  "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace";
const sansStack =
  "'Inter', 'InterVariable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const options: ThemeOptions = {
  palette: {
    mode: 'dark',
    primary: {
      main: teal,
      light: '#5EEAD4',
      dark: '#14B8A6',
      contrastText: '#000000',
    },
    secondary: {
      main: bridgeCyan,
      light: '#22D3EE',
      dark: '#0891B2',
      contrastText: '#000000',
    },
    info: { main: bridgeCyan, contrastText: bg },
    success: { main: success, contrastText: bg },
    warning: { main: warning, contrastText: bg },
    error: { main: danger, contrastText: '#FFFFFF' },
    background: {
      default: bg,
      paper: bg,
    },
    text: {
      primary: textPrimary,
      secondary: textSecondary,
      disabled: textMuted,
    },
    divider: borderSubtle,
    surface: {
      main: surface2,
      light: surface3,
      dark: bg,
      contrastText: textPrimary,
    },
  },
  typography: {
    fontFamily: monoStack,
    h1: { fontWeight: 700, letterSpacing: '-0.02em', fontFamily: sansStack },
    h2: { fontWeight: 700, letterSpacing: '-0.02em', fontFamily: sansStack },
    h3: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '2.25rem', fontFamily: sansStack },
    h4: { fontWeight: 600, letterSpacing: '-0.015em', fontSize: '1.5rem', fontFamily: sansStack },
    h5: { fontWeight: 600, letterSpacing: '-0.01em', fontSize: '1.15rem' },
    h6: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: '0.01em' },
    body1: { fontSize: '0.88rem', lineHeight: 1.55 },
    body2: { fontSize: '0.8rem', lineHeight: 1.5 },
    caption: { letterSpacing: '0.04em', fontSize: '0.7rem' },
    overline: { letterSpacing: '0.16em', fontSize: '0.66rem', fontWeight: 600 },
    allVariants: { color: textPrimary },
  },
  shape: { borderRadius: 8 },
  custom: {
    bg,
    midnightIndigo,
    cardanoBlue,
    deepViolet,
    bridgeCyan,
    teal,
    borderSubtle,
    borderStrong,
    textPrimary,
    textSecondary,
    textMuted,
    success,
    warning,
    danger,
    // legacy aliases
    surface0,
    surface1,
    surface2,
    surface3,
    accent: teal,
    accentSoft: alpha(teal, 0.12),
    accentGradient,
    midnightGlow,
    terminalGreen,
    terminalRed,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': { colorScheme: 'dark' },
        html: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        body: {
          backgroundColor: bg,
          backgroundImage: midnightGlow,
          backgroundAttachment: 'fixed',
          backgroundRepeat: 'no-repeat',
        },
        'code, kbd, pre, samp': { fontFamily: monoStack },
        '*::selection': {
          background: alpha(teal, 0.35),
          color: textPrimary,
        },
        '*::-webkit-scrollbar': { width: 6, height: 6 },
        '*::-webkit-scrollbar-track': { background: bg },
        '*::-webkit-scrollbar-thumb': {
          background: alpha('#FFFFFF', 0.08),
          borderRadius: 3,
        },
        '*::-webkit-scrollbar-thumb:hover': {
          background: alpha('#FFFFFF', 0.16),
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: 8,
          backgroundColor: bg,
          border: `1px solid ${borderSubtle}`,
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: bg,
          border: `1px solid ${borderSubtle}`,
          borderRadius: 8,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '16px 18px',
          '&:last-child': { paddingBottom: 16 },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 600,
          fontFamily: monoStack,
          fontSize: '0.78rem',
          padding: '8px 16px',
          textTransform: 'none',
          transition: 'all 140ms ease',
        },
        sizeLarge: {
          padding: '12px 22px',
          fontSize: '0.88rem',
        },
        containedPrimary: {
          background: teal,
          color: '#000000',
          boxShadow: `0 6px 20px ${alpha(teal, 0.25)}`,
          '&:hover': {
            background: '#5EEAD4',
            boxShadow: `0 8px 28px ${alpha(teal, 0.4)}`,
          },
          '&.Mui-disabled': {
            background: alpha(teal, 0.18),
            color: alpha('#FFFFFF', 0.4),
            boxShadow: 'none',
          },
        },
        containedSecondary: {
          background: bridgeCyan,
          color: '#000000',
          '&:hover': { background: '#22D3EE' },
        },
        outlinedPrimary: {
          borderColor: borderStrong,
          color: textPrimary,
          '&:hover': {
            borderColor: teal,
            color: teal,
            backgroundColor: alpha(teal, 0.06),
          },
        },
        outlinedSecondary: {
          borderColor: borderStrong,
          color: textPrimary,
          '&:hover': {
            borderColor: bridgeCyan,
            color: '#FFFFFF',
            backgroundColor: alpha(bridgeCyan, 0.12),
          },
        },
        text: {
          color: textSecondary,
          '&:hover': { backgroundColor: alpha('#FFFFFF', 0.04), color: textPrimary },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          color: textSecondary,
          '&:hover': { color: textPrimary, backgroundColor: alpha('#FFFFFF', 0.05) },
        },
      },
    },
    MuiTextField: { defaultProps: { variant: 'outlined' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontFamily: monoStack,
          fontSize: '0.82rem',
          backgroundColor: bg,
          transition: 'border-color 140ms ease, background-color 140ms ease',
          '& fieldset': { borderColor: borderSubtle },
          '&:hover fieldset': { borderColor: borderStrong },
          '&.Mui-focused': {
            backgroundColor: alpha(teal, 0.03),
            '& fieldset': { borderColor: teal, borderWidth: 1 },
          },
        },
        input: { padding: '12px 14px' },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: textMuted,
          fontFamily: monoStack,
          fontSize: '0.78rem',
          '&.Mui-focused': { color: teal },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          fontWeight: 500,
          fontFamily: monoStack,
          fontSize: '0.66rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
          height: 22,
        },
        outlined: { borderColor: borderStrong, color: textSecondary },
        colorSuccess: { backgroundColor: alpha(success, 0.16), color: success },
        colorError: { backgroundColor: alpha(danger, 0.18), color: danger },
        colorWarning: { backgroundColor: alpha(warning, 0.18), color: warning },
        colorInfo: { backgroundColor: alpha(bridgeCyan, 0.16), color: bridgeCyan },
        colorPrimary: { backgroundColor: alpha(teal, 0.14), color: teal },
        colorSecondary: { backgroundColor: alpha(bridgeCyan, 0.18), color: bridgeCyan },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          border: `1px solid ${borderSubtle}`,
          backgroundColor: bg,
          padding: '8px 12px',
          alignItems: 'center',
          fontFamily: monoStack,
          fontSize: '0.78rem',
        },
        standardInfo: {
          backgroundColor: alpha(teal, 0.06),
          borderColor: alpha(teal, 0.2),
          color: textPrimary,
          '& .MuiAlert-icon': { color: teal },
        },
        standardSuccess: {
          backgroundColor: alpha(success, 0.08),
          borderColor: alpha(success, 0.22),
          color: textPrimary,
          '& .MuiAlert-icon': { color: success },
        },
        standardWarning: {
          backgroundColor: alpha(warning, 0.08),
          borderColor: alpha(warning, 0.22),
          color: textPrimary,
          '& .MuiAlert-icon': { color: warning },
        },
        standardError: {
          backgroundColor: alpha(danger, 0.08),
          borderColor: alpha(danger, 0.22),
          color: textPrimary,
          '& .MuiAlert-icon': { color: danger },
        },
        filledInfo: {
          backgroundColor: teal,
          color: '#000000',
          border: 'none',
          '& .MuiAlert-icon': { color: '#000000' },
          '& .MuiAlert-action .MuiIconButton-root': { color: '#000000' },
        },
        filledSuccess: {
          backgroundColor: success,
          color: bg,
          border: 'none',
          '& .MuiAlert-icon': { color: bg },
          '& .MuiAlert-action .MuiIconButton-root': { color: bg },
        },
        filledWarning: {
          backgroundColor: warning,
          color: bg,
          border: 'none',
          '& .MuiAlert-icon': { color: bg },
          '& .MuiAlert-action .MuiIconButton-root': { color: bg },
        },
        filledError: {
          backgroundColor: danger,
          color: '#FFFFFF',
          border: 'none',
          '& .MuiAlert-icon': { color: '#FFFFFF' },
          '& .MuiAlert-action .MuiIconButton-root': { color: '#FFFFFF' },
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: bg,
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          borderBottom: `1px solid ${borderSubtle}`,
          color: textPrimary,
        },
      },
    },
    MuiToolbar: {
      styleOverrides: { root: { minHeight: 56 } },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: borderSubtle } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: bg,
          backgroundImage: 'none',
          border: `1px solid ${borderSubtle}`,
          borderRadius: 8,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#111111',
          color: textPrimary,
          border: `1px solid ${alpha(teal, 0.2)}`,
          fontSize: 11,
          fontWeight: 500,
          fontFamily: monoStack,
          borderRadius: 4,
          padding: '5px 8px',
        },
        arrow: { color: '#111111' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          backgroundColor: alpha('#FFFFFF', 0.06),
        },
        bar: { background: accentGradient },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-root': {
            color: textMuted,
            fontWeight: 600,
            fontFamily: monoStack,
            fontSize: '0.66rem',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderBottomColor: borderSubtle,
            padding: '10px 14px',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottomColor: borderSubtle,
          fontFamily: monoStack,
          fontSize: '0.78rem',
          padding: '10px 14px',
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          backgroundColor: bg,
          color: textPrimary,
          border: `1px solid ${borderSubtle}`,
          borderRadius: 6,
          fontFamily: monoStack,
        },
      },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: {
        root: {
          color: teal,
          fontWeight: 500,
          '&:hover': { color: textPrimary },
        },
      },
    },
  },
};

export const theme = createTheme(options);
