import {defineConfig} from '@playwright/test';
const python=process.env.MW_TEST_PYTHON || 'python';
export default defineConfig({testDir:'tests/e2e',testMatch:'ux.spec.js',timeout:20000,expect:{timeout:5000},workers:1,use:{baseURL:'http://127.0.0.1:8012',browserName:'chromium',launchOptions:{executablePath:process.env.MW_TEST_BROWSER||undefined},viewport:{width:390,height:844},serviceWorkers:'block'},webServer:{command:`"${python}" -m uvicorn main:app --host 127.0.0.1 --port 8012`,url:'http://127.0.0.1:8012/health',reuseExistingServer:false,timeout:30000}});
