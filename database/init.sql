CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(512) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portals (
  id VARCHAR(64) PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  estado VARCHAR(100),
  scraper_type VARCHAR(50) DEFAULT 'auto',
  status ENUM('active', 'error', 'pending') DEFAULT 'active',
  last_checked TIMESTAMP NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS captured_tenders (
  id VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  portal_id VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  date VARCHAR(50),
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  started_by INT NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  total_found INT DEFAULT 0,
  status ENUM('running', 'completed', 'error') DEFAULT 'running',
  log TEXT,
  FOREIGN KEY (started_by) REFERENCES users(id)
);
