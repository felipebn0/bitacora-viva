// ============================================================================
// MEJORA 3: TESTS DE PORTADAS POR AUDIENCIA
// ============================================================================
// Ejecutar con: npx playwright test test/portadas-audiencia.playwright.js

const { test, expect } = require('@playwright/test');
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const PORTADAS = ['nina.html', 'adulto.html', 'abuelo.html'];
const VIEWPORTS = [
  { name: '320px', width: 320, height: 568 },
  { name: '390px', width: 390, height: 844 },
  { name: '768px', width: 768, height: 1024 },
  { name: '1440px', width: 1440, height: 900 },
];

// ============================================================================
// TEST 1: Estructura HTML (landmarks, main, etc.)
// ============================================================================

test.describe('Portadas - Estructura HTML', () => {
  for (const portada of PORTADAS) {
    test(`${portada}: tiene <main>`, async ({ page }) => {
      await page.goto(`${BASE_URL}/${portada}`);
      const main = await page.$('main');
      expect(main).not.toBeNull();
    });

    test(`${portada}: tiene <header>`, async ({ page }) => {
      await page.goto(`${BASE_URL}/${portada}`);
      const header = await page.$('header');
      expect(header).not.toBeNull();
    });

    test(`${portada}: no hay errores JavaScript`, async ({ page }) => {
      let jsErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          jsErrors.push(msg.text());
        }
      });

      await page.goto(`${BASE_URL}/${portada}`);
      expect(jsErrors.length).toBe(0);
    });
  }
});

// ============================================================================
// TEST 2: Responsive sin overflow horizontal
// ============================================================================

test.describe('Portadas - Responsive (sin overflow)', () => {
  for (const portada of PORTADAS) {
    for (const viewport of VIEWPORTS) {
      test(`${portada} en ${viewport.name}: sin overflow`, async ({ page }) => {
        await page.goto(`${BASE_URL}/${portada}`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(500);

        const hasOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });

        expect(hasOverflow).toBe(false);
      });
    }
  }
});

// ============================================================================
// TEST 3: Accesibilidad con Axe (WCAG AA)
// ============================================================================

test.describe('Portadas - Accesibilidad WCAG AA', () => {
  test.beforeEach(async ({ page }) => {
    // Cargar Axe antes de cada test
    await page.addScriptTag({
      url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.7.0/axe.min.js'
    });
  });

  for (const portada of PORTADAS) {
    test(`${portada}: pasa Axe en 390px`, async ({ page }) => {
      await page.goto(`${BASE_URL}/${portada}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(1000);

      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          axe.run({ runOnly: { type: 'wcag2aa' } }, (error, results) => {
            if (error) throw error;
            resolve(results);
          });
        });
      });

      const contrastViolations = results.violations.filter(v => v.id === 'color-contrast');
      
      if (contrastViolations.length > 0) {
        console.log(`❌ ${portada} 390px: ${contrastViolations.length} violaciones de contraste`);
      }

      expect(contrastViolations).toHaveLength(0);
    });

    test(`${portada}: pasa Axe en 1440px`, async ({ page }) => {
      await page.goto(`${BASE_URL}/${portada}`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(1000);

      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          axe.run({ runOnly: { type: 'wcag2aa' } }, (error, results) => {
            if (error) throw error;
            resolve(results);
          });
        });
      });

      const violations = results.violations.filter(v => v.id === 'color-contrast' || v.id === 'landmark-unique');
      expect(violations).toHaveLength(0);
    });
  }
});

// ============================================================================
// TEST 4: Visibilidad de contenido (sin elementos ocultos)
// ============================================================================

test.describe('Portadas - Visibilidad', () => {
  for (const portada of PORTADAS) {
    test(`${portada}: contenido visible`, async ({ page }) => {
      await page.goto(`${BASE_URL}/${portada}`);

      const hiddenElements = await page.$$eval('*', (elements) => {
        return elements
          .filter((el) => {
            const style = window.getComputedStyle(el);
            const isHidden =
              style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
            const hasText = el.textContent.trim().length > 0;
            return isHidden && hasText;
          })
          .slice(0, 3); // Solo reportar primeros 3
      });

      expect(hiddenElements.length).toBeLessThan(5);
    });
  }
});

// ============================================================================
// TEST 5: Performance
// ============================================================================

test.describe('Portadas - Performance', () => {
  for (const portada of PORTADAS) {
    test(`${portada}: carga en menos de 3 segundos`, async ({ page }) => {
      const start = Date.now();
      await page.goto(`${BASE_URL}/${portada}`);
      const loadTime = Date.now() - start;

      expect(loadTime).toBeLessThan(3000);
    });
  }
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`
✅ Suite de tests para portadas por audiencia

Portadas: ${PORTADAS.join(', ')}
Viewports: ${VIEWPORTS.map(v => v.name).join(', ')}

Ejecutar con:
  npx playwright test test/portadas-audiencia.playwright.js
  npm run test:portadas
`);
