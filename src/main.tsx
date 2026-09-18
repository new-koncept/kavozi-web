import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { CssBaseline, ThemeProvider } from '@mui/material'
import './index.css'
import App from './app/App'
import { theme } from './app/theme'
import { createQueryClient } from './app/queryClient'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></QueryClientProvider>
  </StrictMode>,
)
