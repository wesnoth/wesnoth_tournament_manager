import { api } from './api';

export interface Country {
  code: string;
  name: string;
  flag: string;
  official_name?: string;
  region?: string;
  names?: Record<string, string>;
}

export interface Avatar {
  id: string;
  name: string;
  path: string;
  filename: string;
}

class CountriesService {
  private countriesCache: Country[] = [];
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hour

  async getCountries(language: string = 'en'): Promise<Country[]> {
    const now = Date.now();
    
    // Return cached data if still valid
    if (this.countriesCache.length > 0 && now - this.cacheTimestamp < this.CACHE_DURATION) {
      console.log('🔄 Returning cached countries:', this.countriesCache.length);
      return this.countriesCache;
    }

    try {
      // Try to get from backend first
      try {
        console.log('🌐 Fetching from backend...');
        const response = await api.get('/users/data/countries', {
          params: { lang: language }
        });
        
        console.log('✅ Backend response received:', response.data);
        
        if (response.data && Array.isArray(response.data)) {
          // Ensure all countries have proper flag and name
          const countries = response.data.map((country: any) => ({
            code: country.code,
            name: country.name || 'Unknown',
            flag: country.flag || country.flag_emoji || '🌍',
            official_name: country.official_name,
            region: country.region,
            names: country.names
          }));
          
          console.log('✨ Transformed countries:', countries.length);
          console.log('🏁 First country:', countries[0]);
          
          this.countriesCache = countries;
          this.cacheTimestamp = now;
          return countries;
        }
      } catch (backendError) {
        console.warn('⚠️ Backend fetch failed:', backendError);
      }
      
      // Fallback to local JSON data
      console.log('📁 Loading from local JSON...');
      const response = await fetch('/data/countries.json');
      const data = await response.json();
      
      // Transform the data to match the expected format
      const countries = data.countries.map((country: any) => ({
        code: country.code,
        name: country.names[language] || country.names['en'] || country.code,
        flag: country.flag || country.flag_emoji || '🌍',
        official_name: country.official_name,
        region: country.region,
        names: country.names
      }));
      
      console.log('✨ Local countries loaded:', countries.length);
      console.log('🏁 First country:', countries[0]);
      
      this.countriesCache = countries;
      this.cacheTimestamp = now;
      return countries;
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      return [];
    }
  }

  async getCountriesByLanguage(language: string): Promise<Country[]> {
    return this.getCountries(language);
  }

  clearCache(): void {
    this.countriesCache = [];
    this.cacheTimestamp = 0;
  }
}

class AvatarsService {
  private manifestCache: any = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hour
  private readonly API_RETRY_ATTEMPTS = 5;
  private readonly API_RETRY_DELAY_MS = 1000;

  async getManifest(): Promise<any> {
    const now = Date.now();
    
    if (this.manifestCache && now - this.cacheTimestamp < this.CACHE_DURATION) {
      return this.manifestCache;
    }

    for (let attempt = 1; attempt <= this.API_RETRY_ATTEMPTS; attempt += 1) {
      try {
        console.log(`🔄 Fetching avatar manifest from backend API (attempt ${attempt}/${this.API_RETRY_ATTEMPTS})...`);
        const response = await api.get('/users/data/avatar-manifest');
        this.manifestCache = response.data;
        this.cacheTimestamp = now;
        console.log('✅ Avatar manifest loaded from backend API');
        return this.manifestCache;
      } catch (error) {
        if (attempt === this.API_RETRY_ATTEMPTS) {
          console.error('❌ Backend API unavailable; avatar manifest could not be loaded:', error);
          return [];
        }

        const delay = this.API_RETRY_DELAY_MS * attempt;
        console.warn(`⚠️ Backend API unavailable, retrying avatar manifest in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return [];
  }

  async getAvatars(): Promise<Avatar[]> {
    const manifest = await this.getManifest();
    if (!manifest) {
      return [];
    }

    // Handle both array and object formats
    const avatarsArray = Array.isArray(manifest) ? manifest : (manifest.avatars || []);

    return avatarsArray.map((avatar: any) => ({
      id: avatar.id,
      name: avatar.name,
      // Encode the filename to handle special characters like parentheses
      path: `/wesnoth-avatars/${encodeURIComponent(avatar.filename)}`,
      filename: avatar.filename
    }));
  }

  clearCache(): void {
    this.manifestCache = null;
    this.cacheTimestamp = 0;
  }
}

export const countriesService = new CountriesService();
export const avatarsService = new AvatarsService();
