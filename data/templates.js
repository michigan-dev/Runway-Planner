/* Starting points for the Templates dropdown. Amounts are whole US dollars. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RUNWAY_TEMPLATES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    generic: {
      label: 'Generic hardware',
      state: {
        company: 'Acme Hardware', startingCash: 1000000, baseBurn: 60000, raiseAmount: 0, raiseMonth: 12,
        stages: [
          { name: 'Lab prototype', duration: 3, cost: 80000, extraBurn: 5000, derisks: 'Core physics works on the bench' },
          { name: 'Engineering prototype', duration: 4, cost: 150000, extraBurn: 10000, derisks: 'Design is repeatable and meets target specs' },
          { name: 'Pilot build / field test', duration: 5, cost: 250000, extraBurn: 15000, derisks: 'Works outside the lab with real users' },
          { name: 'Certification / compliance', duration: 3, cost: 120000, extraBurn: 5000, derisks: 'Cleared to sell in target markets' },
          { name: 'First production run', duration: 4, cost: 400000, extraBurn: 20000, derisks: 'Can manufacture at target unit cost and yield' }
        ]
      }
    },
    energy: {
      label: 'Energy hardware',
      state: {
        company: 'Volt Works', startingCash: 1000000, baseBurn: 70000, raiseAmount: 1500000, raiseMonth: 8,
        stages: [
          { name: 'Bench-scale proof of concept', duration: 4, cost: 90000, extraBurn: 10000, derisks: 'Cell or device hits target performance' },
          { name: 'Subscale prototype', duration: 5, cost: 180000, extraBurn: 15000, derisks: 'Performance holds at larger scale and cycle life' },
          { name: 'Pilot unit / field demo', duration: 6, cost: 320000, extraBurn: 25000, derisks: 'Operates reliably on site with a design partner' },
          { name: 'Safety and grid certification', duration: 4, cost: 150000, extraBurn: 5000, derisks: 'UL / IEC / interconnect approvals in hand' },
          { name: 'Pilot manufacturing line', duration: 5, cost: 450000, extraBurn: 25000, derisks: 'Repeatable yield and cost per kWh' }
        ]
      }
    },
    materials: {
      label: 'Advanced materials',
      state: {
        company: 'Novel Materials Co.', startingCash: 1000000, baseBurn: 55000, raiseAmount: 0, raiseMonth: 12,
        stages: [
          { name: 'Synthesis and characterization', duration: 4, cost: 70000, extraBurn: 12000, derisks: 'Material reproducibly meets the key property target' },
          { name: 'Process scale-up (kg scale)', duration: 5, cost: 140000, extraBurn: 20000, derisks: 'Properties survive scale-up; unit economics visible' },
          { name: 'Customer sample qualification', duration: 4, cost: 90000, extraBurn: 8000, derisks: 'Paying customers validate performance in their process' },
          { name: 'Pilot line / toll-manufacturing run', duration: 5, cost: 300000, extraBurn: 25000, derisks: 'Volume supply at target cost and quality' },
          { name: 'Regulatory and spec compliance', duration: 3, cost: 60000, extraBurn: 3000, derisks: 'REACH / TSCA and customer specs cleared' }
        ]
      }
    }
  };
});
