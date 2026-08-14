import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { TablePage } from './pages/public/TablePage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />

      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/admin" element={<AdminDashboardPage />} />
      </Route>

      <Route path="/v/:venueSlug/t/:tableToken" element={<TablePage />} />

      <Route path="*" element={<p style={{ padding: 24 }}>Stránka nenalezena.</p>} />
    </Routes>
  )
}
