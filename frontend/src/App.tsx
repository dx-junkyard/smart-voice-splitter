import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import DetailView from './components/DetailView';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profiles/:profileId" element={<DetailView />} />
      </Routes>
    </Router>
  );
}

export default App;
