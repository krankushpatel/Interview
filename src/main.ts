import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { addIcons } from 'ionicons';
import { 
  cloudUploadOutline,
  downloadOutline,
  sendOutline,
  calendarOutline,
  peopleOutline,
  eyeOffOutline,
  informationCircleOutline,
  calendarNumberOutline,
  cloudDoneOutline
} from 'ionicons/icons';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { authInterceptor } from './app/interceptors/auth.interceptor';
import { mockApiInterceptor } from './app/interceptors/mock-api.interceptor';

// Register all Ionicons used in the app
addIcons({
  'cloud-upload-outline': cloudUploadOutline,
  'download-outline': downloadOutline,
  'send-outline': sendOutline,
  'calendar-outline': calendarOutline,
  'people-outline': peopleOutline,
  'eye-off-outline': eyeOffOutline,
  'information-circle-outline': informationCircleOutline,
  'calendar-number-outline': calendarNumberOutline,
  'cloud-done-outline': cloudDoneOutline
});

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideHttpClient(
      withInterceptors([authInterceptor, mockApiInterceptor])
    ),
  ],
});