/**
 * Design system — Cardano-blue on Midnight-dark, Uniswap-inspired geometry.
 *
 *   background  midnight near-black with a violet undertone
 *   surface     layered dark navy for cards and inputs
 *   accent      Cardano royal blue — used for primary CTAs and focus rings
 *   radii       999 for buttons (pill), 24 for cards, 20 for inputs
 *   font        Inter via Google Fonts (linked in index.html)
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

const accentGradient = `linear-gradient(135deg, ${cardanoBlueBright} 0%, ${cardanoBlue} 45%, ${cardanoBlueDeep} 100%)`;
const midnightGlow = `radial-gradient(circle at 50% -10%, ${alpha(cardanoBlue, 0.22)} 0%, transparent 55%)`;

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
    fontFamily:
      "'Inter', 'InterVariable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '2.25rem' },
    h4: { fontWeight: 600, letterSpacing: '-0.015em', fontSize: '1.65rem' },
    h5: { fontWeight: 600, letterSpacing: '-0.01em', fontSize: '1.25rem' },
    h6: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    body1: { fontSize: '0.96rem', lineHeight: 1.55 },
    body2: { fontSize: '0.86rem', lineHeight: 1.5 },
    caption: { letterSpacing: 0 },
    allVariants: { color: textPrimary },
  },
  shape: { borderRadius: 16 },
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
          fontFamily:
            "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace",
        },
        '*::selection': {
          background: alpha(cardanoBlue, 0.35),
          color: textPrimary,
        },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': {
          background: alpha('#ffffff', 0.08),
          borderRadius: 6,
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
          borderRadius: 20,
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
          borderRadius: 20,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '20px 22px',
          '&:last-child': { paddingBottom: 20 },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 600,
          padding: '9px 18px',
          textTransform: 'none',
          transition: 'all 140ms ease',
        },
        sizeLarge: {
          padding: '14px 24px',
          fontSize: '1rem',
        },
        containedPrimary: {
          background: accentGradient,
          boxShadow: `0 10px 30px ${alpha(cardanoBlue, 0.25)}`,
          '&:hover': {
            background: accentGradient,
            boxShadow: `0 14px 36px ${alpha(cardanoBlue, 0.38)}`,
            transform: 'translateY(-1px)',
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
          borderRadius: 12,
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
          borderRadius: 14,
          backgroundColor: alpha('#ffffff', 0.02),
          transition: 'border-color 140ms ease, background-color 140ms ease',
          '& fieldset': { borderColor: borderSubtle },
          '&:hover fieldset': { borderColor: borderStrong },
          '&.Mui-focused': {
            backgroundColor: alpha(cardanoBlue, 0.05),
            '& fieldset': { borderColor: cardanoBlue, borderWidth: 1 },
          },
        },
        input: { padding: '14px 16px' },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: textMuted,
          '&.Mui-focused': { color: cardanoBlueBright },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 500,
          fontSize: '0.78rem',
          letterSpacing: 0,
          height: 26,
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
          borderRadius: 16,
          border: `1px solid ${borderSubtle}`,
          backgroundColor: surface1,
          padding: '10px 14px',
          alignItems: 'center',
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
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: alpha(surface0, 0.8),
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          borderBottom: `1px solid ${borderSubtle}`,
          color: textPrimary,
        },
      },
    },
    MuiToolbar: {
      styleOverrides: { root: { minHeight: 68 } },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: borderSubtle } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: surface1,
          backgroundImage: midnightGlow,
          backgroundRepeat: 'no-repeat',
          border: `1px solid ${borderSubtle}`,
          borderRadius: 24,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: surface3,
          color: textPrimary,
          border: `1px solid ${borderStrong}`,
          fontSize: 12,
          fontWeight: 500,
          borderRadius: 10,
          padding: '6px 10px',
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
            fontSize: '0.76rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            borderBottomColor: borderSubtle,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottomColor: borderSubtle,
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          backgroundColor: surface2,
          color: textPrimary,
          border: `1px solid ${borderSubtle}`,
          borderRadius: 14,
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
