import { useState, type ReactNode } from 'react'
import { App as AntApp, ConfigProvider, theme } from 'antd'
import viVN from 'antd/locale/vi_VN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={viVN}
        componentSize="small"
        theme={{
          algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
          token: {
            colorPrimary: '#e57000',
            borderRadius: 4,
            fontSize: 13,
          },
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  )
}
