# Deployment Scripts

Server management, backend deployment, and development server utilities.

## 📁 Scripts

- **start_backend.sh** - Start backend services
- **start_server.sh** - Start main application server
- **dev_server.sh** - Start development server with hot reload

## 🚀 Usage

### Start Backend
```bash
./start_backend.sh
```

### Start Server
```bash
./start_server.sh
```

### Development Server
```bash
./dev_server.sh
```

## 📝 Notes

- Check port availability before starting servers
- Development server includes hot reload and debugging
- Backend services may require Redis/database setup
- Use `scripts/data/setup_redis.sh` first if needed
