/**
 * Design system — Cardano-blue on Midnight-dark, ContraClear terminal layout.
 *
 *   background  midnight near-black with a violet undertone
 *   surface     layered dark navy for cards and inputs
 *   accent      Cardano royal blue — used for primary CTAs and focus rings
 *   radii       terminal-tight: 8 for panels, 6 for inputs, 999 for pills
 *   font        JetBrains Mono primary, Inter fallback (loaded in index.html)
 *
 * All custom tokens live on `theme.custom` so pages can reach them
 * without re-deriving palette math.
 */

import { createTheme, alpha, type ThemeOptions } from '@mui/material';

declare module '@mui/material/styles' {
  interface Theme {
    custom: {
      surface0: string;
      surface1: string;
      surface2: string;
      surface3: string;
      borderSubtle: string;
      borderStrong: string;
      accent: string;
      accentSoft: string;
      accentGradient: string;
      cardanoBlue: string;
      midnightGlow: string;
      success: string;
      warning: string;
      danger: string;
      textPrimary: string;
      textSecondary: string;
      textMuted: string;
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

const cardanoBlue = '#2E7BFF';
const cardanoBlueBright = '#4B8CFF';
const cardanoBlueDeep = '#1A4FD1';

const surface0 = '#0A0B13';
const surface1 = '#12131E';
const surface2 = '#1A1C2B';
const surface3 = '#242738';

const textPrimary = '#F5F7FA';
const textSecondary = alpha('#F5F7FA', 0.64);
const textMuted = alpha('#F5F7FA', 0.42);

const borderSubtle = alpha('#ffffff', 0.06);
const borderStrong = alpha('#ffffff', 0.12);

const success = '#4ADE80';
const warning = '#FBBF24';
const danger = '#F87171';

const terminalGreen = '#39FF14';
const terminalRed = '#FF3B3B';

const accentGradient = `linear-gradient(135deg, ${cardanoBlueBright} 0%, ${cardanoBlue} 45%, ${cardanoBlueDeep} 100%)`;
const midnightGlow = `radial-gradient(circle at 50% -10%, ${alpha(cardanoBlue, 0.22)} 0%, transparent 55%)`;

const monoStack = "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace";
const sansStack = "'Inter', 'InterVariable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const options: ThemeOptions = {
  palette: {
    mode: 'dark',
    primary: {
      main: cardanoBlue,
      light: cardanoBlueBright,
      dark: cardanoBlueDeep,
      contrastText: '#ffffff',
    },
    secondary: {
      main: cardanoBlueBright,
    },
    success: { main: success },
    warning: { main: warning },
    error: { main: danger },
    info: { main: cardanoBlueBright },
    background: {
      default: surface0,
      paper: surface1,
    },
    text: {
      primary: textPrimary,
      secondary: textSecondary,
      disabled: textMuted,
    },
    divider: borderSubtle,
    surface: { main: surface2, light: surface3, dark: surface1, contrastText: textPrimary },
  },
  typography: {
    fontFamily: monoStack,
    h1: { fontWeight: 700, letterSpacing: '-0.02em', fontFamily: sansStack },
    h2: { fontWeight: 700, letterSpacing: '-0.02em', fontFamily: sansStack },
    h3: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '2.25rem', fontFamily: sansStack },
    h4: { fontWeight: 600, letterSpacing: '-0.015em', fontSize: '1.65rem', fontFamily: sansStack },
    h5: { fontWeight: 600, letterSpacing: '-0.01em', fontSize: '1.25rem', fontFamily: sansStack },
    h6: { fontWeight: 600, letterSpacing: '-0.01em', fontFamily: sansStack },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    body1: { fontSize: '0.88rem', lineHeight: 1.55 },
    body2: { fontSize: '0.8rem', lineHeight: 1.5 },
    caption: { letterSpacing: '0.02em', fontSize: '0.72rem' },
    allVariants: { color: textPrimary },
  },
  shape: { borderRadius: 8 },
  custom: {
    surface0,
    surface1,
    surface2,
    surface3,
    borderSubtle,
    borderStrong,
    accent: cardanoBlue,
    accentSoft: alpha(cardanoBlue, 0.16),
    accentGradient,
    cardanoBlue,
    midnightGlow,
    success,
    warning,
    danger,
    textPrimary,
    textSecondary,
    textMuted,
    terminalGreen,
    terminalRed,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          colorScheme: 'dark',
        },
        html: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        body: {
          backgroundColor: surface0,
          backgroundImage: midnightGlow,
          backgroundAttachment: 'fixed',
          backgroundRepeat: 'no-repeat',
        },
        'code, kbd, pre, samp': {
          fontFamily: monoStack,
        },
        '*::selection': {
          background: alpha(cardanoBlue, 0.35),
          color: textPrimary,
        },
        '*::-webkit-scrollbar': { width: 6, height: 6 },
        '*::-webkit-scrollbar-track': { background: surface0 },
        '*::-webkit-scrollbar-thumb': {
          background: alpha('#ffffff', 0.08),
          borderRadius: 3,
        },
        '*::-webkit-scrollbar-thumb:hover': {
          background: alpha('#ffffff', 0.14),
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: 8,
          backgroundColor: surface1,
          border: `1px solid ${borderSubtle}`,
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: surface1,
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
          background: accentGradient,
          boxShadow: `0 8px 24px ${alpha(cardanoBlue, 0.25)}`,
          '&:hover': {
            background: accentGradient,
            boxShadow: `0 10px 30px ${alpha(cardanoBlue, 0.38)}`,
            filter: 'brightness(1.1)',
          },
          '&.Mui-disabled': {
            background: alpha(cardanoBlue, 0.22),
            color: alpha('#ffffff', 0.5),
            boxShadow: 'none',
          },
        },
        containedSecondary: {
          backgroundColor: alpha(cardanoBlue, 0.16),
          color: cardanoBlueBright,
          '&:hover': { backgroundColor: alpha(cardanoBlue, 0.26) },
        },
        outlinedPrimary: {
          borderColor: alpha(cardanoBlue, 0.4),
          color: cardanoBlueBright,
          '&:hover': {
            borderColor: cardanoBlueBright,
            backgroundColor: alpha(cardanoBlue, 0.08),
          },
        },
        text: {
          color: textSecondary,
          '&:hover': { backgroundColor: alpha('#ffffff', 0.04), color: textPrimary },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          color: textSecondary,
          '&:hover': {
            color: textPrimary,
            backgroundColor: alpha('#ffffff', 0.05),
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontFamily: monoStack,
          fontSize: '0.82rem',
          backgroundColor: alpha('#ffffff', 0.02),
          transition: 'border-color 140ms ease, background-color 140ms ease',
          '& fieldset': { borderColor: borderSubtle },
          '&:hover fieldset': { borderColor: borderStrong },
          '&.Mui-focused': {
            backgroundColor: alpha(cardanoBlue, 0.05),
            '& fieldset': { borderColor: cardanoBlue, borderWidth: 1 },
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
          '&.Mui-focused': { color: cardanoBlueBright },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          fontWeight: 500,
          fontFamily: monoStack,
          fontSize: '0.68rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase' as const,
          height: 24,
        },
        outlined: {
          borderColor: borderStrong,
          color: textSecondary,
        },
        colorSuccess: {
          backgroundColor: alpha(success, 0.16),
          color: success,
        },
        colorError: {
          backgroundColor: alpha(danger, 0.18),
          color: danger,
        },
        colorWarning: {
          backgroundColor: alpha(warning, 0.18),
          color: warning,
        },
        colorInfo: {
          backgroundColor: alpha(cardanoBlueBright, 0.18),
          color: cardanoBlueBright,
        },
        colorPrimary: {
          backgroundColor: alpha(cardanoBlue, 0.2),
          color: cardanoBlueBright,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          border: `1px solid ${borderSubtle}`,
          backgroundColor: surface1,
          padding: '8px 12px',
          alignItems: 'center',
          fontFamily: monoStack,
          fontSize: '0.78rem',
        },
        standardInfo: {
          backgroundColor: alpha(cardanoBlue, 0.1),
          borderColor: alpha(cardanoBlue, 0.25),
          color: textPrimary,
          '& .MuiAlert-icon': { color: cardanoBlueBright },
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
          backgroundColor: cardanoBlue,
          color: '#ffffff',
          border: 'none',
          '& .MuiAlert-icon': { color: '#ffffff' },
          '& .MuiAlert-action .MuiIconButton-root': { color: '#ffffff' },
        },
        filledSuccess: {
          backgroundColor: success,
          color: '#0a0b13',
          border: 'none',
          '& .MuiAlert-icon': { color: '#0a0b13' },
          '& .MuiAlert-action .MuiIconButton-root': { color: '#0a0b13' },
        },
        filledWarning: {
          backgroundColor: warning,
          color: '#0a0b13',
          border: 'none',
          '& .MuiAlert-icon': { color: '#0a0b13' },
          '& .MuiAlert-action .MuiIconButton-root': { color: '#0a0b13' },
        },
        filledError: {
          backgroundColor: danger,
          color: '#ffffff',
          border: 'none',
          '& .MuiAlert-icon': { color: '#ffffff' },
          '& .MuiAlert-action .MuiIconButton-root': { color: '#ffffff' },
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: surface1,
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
          backgroundColor: surface1,
          backgroundImage: 'none',
          border: `1px solid ${borderSubtle}`,
          borderRadius: 8,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: surface3,
          color: textPrimary,
          border: `1px solid ${borderStrong}`,
          fontSize: 11,
          fontWeight: 500,
          fontFamily: monoStack,
          borderRadius: 4,
          padding: '5px 8px',
        },
        arrow: { color: surface3 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          backgroundColor: alpha('#ffffff', 0.06),
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
            fontSize: '0.68rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
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
          backgroundColor: surface2,
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
          color: cardanoBlueBright,
          fontWeight: 500,
          '&:hover': { color: textPrimary },
        },
      },
    },
  },
};

export const theme = createTheme(options);
