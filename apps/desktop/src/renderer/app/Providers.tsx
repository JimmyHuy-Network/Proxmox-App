import { useEffect, useState, type ReactNode } from 'react'
import { App as AntApp, ConfigProvider, theme } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { antdLocaleFor, readStoredLanguage } from '../i18n/locale'
import type { SupportedLanguage } from '../i18n'
import i18n from '../i18n'
import { pveAntdToken } from '../theme/tokens'

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Proxmox trả dữ liệu thay đổi liên tục; giữ cache ngắn để giao diện
        // không hiển thị trạng thái cũ sau khi một tác vụ vừa chạy xong.
        staleTime: 5_000,
        retry: (failureCount, error) => {
          // Chỉ thử lại lỗi mạng, và tối đa 3 lần. Không bao giờ thử lại lỗi
          // xác thực hay lỗi tham số — thử lại chỉ tổ gây nhiễu.
          if (failureCount >= 3) return false
          return error instanceof Error && error.name === 'NetworkError'
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Ghi lên Proxmox không idempotent: một lệnh start bị thử lại sẽ đẻ ra
        // hai task. Tuyệt đối không tự động thử lại.
        retry: false,
      },
    },
  })
}

export function Providers({ children }: { children: ReactNode }): React.JSX.Element {
  const [queryClient] = useState(createQueryClient)
  const [lang, setLang] = useState<SupportedLanguage>(() => readStoredLanguage())

  useEffect(() => {
    if (i18n.language !== lang) void i18n.changeLanguage(lang)
    const onLocale = (event: Event): void => {
      const detail = (event as CustomEvent<SupportedLanguage>).detail
      if (detail === 'en' || detail === 'vi') setLang(detail)
    }
    window.addEventListener('pve:locale', onLocale)
    return () => window.removeEventListener('pve:locale', onLocale)
  }, [lang])

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={antdLocaleFor(lang)}
        componentSize="small"
        theme={{
          algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
          token: {
            ...pveAntdToken,
          },
          components: {
            Layout: {
              headerBg: pveAntdToken.colorBgElevated,
              siderBg: pveAntdToken.colorBgContainer,
              bodyBg: pveAntdToken.colorBgBase,
              triggerBg: pveAntdToken.colorBgElevated,
            },
            Menu: {
              darkItemBg: pveAntdToken.colorBgContainer,
              darkSubMenuItemBg: pveAntdToken.colorBgContainer,
              darkItemSelectedBg: 'rgba(0, 242, 254, 0.12)',
              darkItemSelectedColor: pveAntdToken.colorInfo,
              darkItemHoverBg: 'rgba(0, 242, 254, 0.08)',
            },
            Card: {
              colorBgContainer: 'rgba(18, 24, 38, 0.85)',
            },
            Tree: {
              directoryNodeSelectedBg: 'rgba(0, 242, 254, 0.12)',
              directoryNodeSelectedColor: pveAntdToken.colorInfo,
            },
          },
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  )
}
