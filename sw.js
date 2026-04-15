const CACHE_NAME = 'navcore-v2.1';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/database.js',
    './js/engine.js',
    './assets/metro-map.png',
    './assets/arriving.mp3',
    './assets/next_station.mp3',
    './assets/transfer.mp3',
    './assets/wakeup.mp3',
    './assets/bell.wav',
    // All 56 station voice files — cached for full offline operation
    './assets/stations/Ameerpet.mp3',
    './assets/stations/Assembly.mp3',
    './assets/stations/Balanagar.mp3',
    './assets/stations/Begumpet.mp3',
    './assets/stations/Bharat Nagar.mp3',
    './assets/stations/Chaitanyapuri.mp3',
    './assets/stations/Chikkadpally.mp3',
    './assets/stations/Dilsukhnagar.mp3',
    './assets/stations/Durgam Cheruvu.mp3',
    './assets/stations/ESI Hospital.mp3',
    './assets/stations/Erragadda.mp3',
    './assets/stations/Gandhi Bhavan.mp3',
    './assets/stations/Gandhi Hospital.mp3',
    './assets/stations/HITEC City.mp3',
    './assets/stations/Habsiguda.mp3',
    './assets/stations/Irrum Manzil.mp3',
    './assets/stations/JBS Parade Ground.mp3',
    './assets/stations/JNTU College.mp3',
    './assets/stations/Jubilee Hills Check Post.mp3',
    './assets/stations/KPHB Colony.mp3',
    './assets/stations/Khairatabad.mp3',
    './assets/stations/Kukatpally.mp3',
    './assets/stations/LB Nagar.mp3',
    './assets/stations/Lakdikapul.mp3',
    './assets/stations/MG Bus Station.mp3',
    './assets/stations/Madhapur.mp3',
    './assets/stations/Madhura Nagar.mp3',
    './assets/stations/Malakpet.mp3',
    './assets/stations/Mettuguda.mp3',
    './assets/stations/Miyapur.mp3',
    './assets/stations/Moosapet.mp3',
    './assets/stations/Musarambagh.mp3',
    './assets/stations/Musheerabad.mp3',
    './assets/stations/NGRI.mp3',
    './assets/stations/Nagole.mp3',
    './assets/stations/Nampally.mp3',
    './assets/stations/Narayanguda.mp3',
    './assets/stations/New Market.mp3',
    './assets/stations/Osmania Medical College.mp3',
    './assets/stations/Panjagutta.mp3',
    './assets/stations/Paradise.mp3',
    './assets/stations/Peddamma Temple.mp3',
    './assets/stations/Prakash Nagar.mp3',
    './assets/stations/RTC X Roads.mp3',
    './assets/stations/Raidurg.mp3',
    './assets/stations/Rasoolpura.mp3',
    './assets/stations/Road No. 5 Jubilee Hills.mp3',
    './assets/stations/S.R. Nagar.mp3',
    './assets/stations/Secunderabad East.mp3',
    './assets/stations/Secunderabad West.mp3',
    './assets/stations/Stadium.mp3',
    './assets/stations/Sultan Bazaar.mp3',
    './assets/stations/Tarnaka.mp3',
    './assets/stations/Uppal.mp3',
    './assets/stations/Victoria Memorial.mp3',
    './assets/stations/Yusufguda.mp3'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        ))
    );
    return self.clients.claim();
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});
