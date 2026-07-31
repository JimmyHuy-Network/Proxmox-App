import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './i18n'
import './styles.css'
import { Providers } from './app/Providers'
import { router } from './app/router'

const container = document.getElementById('root')
if (!container) throw new Error('Không tìm thấy phần tử #root trong index.html')

createRoot(container).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
