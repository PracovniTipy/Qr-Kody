import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminVenuePage } from './pages/admin/AdminVenuePage'
import { QrStandPage } from './pages/admin/QrStandPage'
import { KitchenPage } from './pages/admin/KitchenPage'
import { RevenuePage } from './pages/admin/RevenuePage'
import { RatingsPage } from './pages/admin/RatingsPage'
import { TournamentsAdminPage } from './pages/admin/TournamentsAdminPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { TablePage } from './pages/public/TablePage'
import { GamePage } from './pages/public/GamePage'
import { FlappyGamePage } from './pages/public/FlappyGamePage'
import { RunnerGamePage } from './pages/public/RunnerGamePage'
import { ClimbGamePage } from './pages/public/ClimbGamePage'
import { BreakoutGamePage } from './pages/public/BreakoutGamePage'
import { PrsiGamePage } from './pages/public/PrsiGamePage'
import { PokerGamePage } from './pages/public/PokerGamePage'
import { DamaGamePage } from './pages/public/DamaGamePage'
import { SachyGamePage } from './pages/public/SachyGamePage'
import { FlaskaGamePage } from './pages/public/FlaskaGamePage'
import { RateVenuePage } from './pages/public/RateVenuePage'
import { TournamentsPage } from './pages/public/TournamentsPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />

      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/admin" element={<AdminDashboardPage />} />
        <Route path="/admin/hospoda/:venueId" element={<AdminVenuePage />} />
        <Route path="/admin/hospoda/:venueId/tisk" element={<QrStandPage />} />
          <Route path="/admin/hospoda/:venueId/kuchyne" element={<KitchenPage />} />
        <Route path="/admin/hospoda/:venueId/trzby" element={<RevenuePage />} />
        <Route path="/admin/hospoda/:venueId/hodnoceni" element={<RatingsPage />} />
        <Route path="/admin/hospoda/:venueId/turnaje" element={<TournamentsAdminPage />} />
      </Route>

      <Route path="/v/:venueSlug/t/:tableToken" element={<TablePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra" element={<GamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-let" element={<FlappyGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-beh" element={<RunnerGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-skok" element={<ClimbGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-lahve" element={<BreakoutGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-prsi" element={<PrsiGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-poker" element={<PokerGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-dama" element={<DamaGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-sachy" element={<SachyGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hra-flaska" element={<FlaskaGamePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/hodnoceni" element={<RateVenuePage />} />
      <Route path="/v/:venueSlug/t/:tableToken/turnaje" element={<TournamentsPage />} />

      <Route path="*" element={<p style={{ padding: 24 }}>Stránka nenalezena.</p>} />
    </Routes>
  )
}
