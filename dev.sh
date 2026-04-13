#!/bin/bash
kill -9 $(lsof -ti:3001) $(lsof -ti:5173) 2>/dev/null
sleep 1
npx concurrently "cd server && deno task dev" "cd client && npm run dev"
