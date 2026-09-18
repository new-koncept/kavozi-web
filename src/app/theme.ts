import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#345e52' },
    secondary: { main: '#8a6845' },
    background: { default: '#f5f3ed', paper: '#fffefa' },
    text: { primary: '#243b33', secondary: '#63736c' },
  },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    h3: { fontFamily: 'Georgia, serif', fontWeight: 400 },
    h4: { fontFamily: 'Georgia, serif', fontWeight: 400 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 18 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderColor: '#dbe1d7' } } },
  },
})
