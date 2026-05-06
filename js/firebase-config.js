'use strict';

const _isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const FIREBASE_CONFIG = _isLocal ? {
  apiKey:            'AIzaSyDyQ2fknc8nrZcCm1msTJGX955mfA2B6iU',
  authDomain:        'mitelflow-hml.firebaseapp.com',
  databaseURL:       'https://mitelflow-hml-default-rtdb.firebaseio.com',
  projectId:         'mitelflow-hml',
  storageBucket:     'mitelflow-hml.firebasestorage.app',
  messagingSenderId: '516562097868',
  appId:             '1:516562097868:web:5297b85603ade5dcd4d469',
} : {
  apiKey:            'AIzaSyDAuJO9CF2vB44eOfc4dFdxuktgDjcMHTc',
  authDomain:        'mitelflow.firebaseapp.com',
  databaseURL:       'https://mitelflow-default-rtdb.firebaseio.com',
  projectId:         'mitelflow',
  storageBucket:     'mitelflow.firebasestorage.app',
  messagingSenderId: '317726334751',
  appId:             '1:317726334751:web:96bab8374f73dad2a4da2a',
};
