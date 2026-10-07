import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import InstalarAoAbrir from './components/InstalarAoAbrir';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import BookDetailPage from './pages/BookDetailPage';
import LibraryPage from './pages/LibraryPage';
import LoginPage from './pages/LoginPage';
import NotesSearchPage from './pages/NotesSearchPage';
import SearchPage from './pages/SearchPage';
import StatsPage from './pages/StatsPage';
import WorkPage from './pages/WorkPage';

export default function App() {
  return (
    <BrowserRouter>
      {/* Fora das rotas de propósito: aparece tanto na tela de login quanto
          logado, porque a primeira visita de quem chega ao site costuma cair
          ali, antes mesmo de ter conta. */}
      <InstalarAoAbrir />
      <AuthProvider>
        <Routes>
          <Route path="/entrar" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/biblioteca" element={<LibraryPage />} />
              <Route path="/biblioteca/:id" element={<BookDetailPage />} />
              <Route path="/pesquisar" element={<SearchPage />} />
              <Route path="/obras/:workId" element={<WorkPage />} />
              <Route path="/anotacoes" element={<NotesSearchPage />} />
              <Route path="/estatisticas" element={<StatsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/biblioteca" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
