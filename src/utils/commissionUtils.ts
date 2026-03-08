import { supabase } from '@/integrations/supabase/client';
import { CommissionEntry } from '@/types/commission';
import { Transaction } from '@/types/transaction';
import { Delivery } from '@/types/delivery';
import { createCommissionExpense } from './financialIntegration';

export async function generateSalesCommission(transaction: Transaction) {
  try {
    // Only generate commission if there's a sales person assigned
    if (!transaction.salesId || !transaction.salesName) {
      return;
    }

    // Get commission rules for sales
    const { data: rules, error: rulesError } = await supabase
      .from('commission_rules')
      .select('*')
      .eq('role', 'sales');

    if (rulesError) {
      if (rulesError.code === 'PGRST116') {
        return; // Table doesn't exist
      }
      throw rulesError;
    }

    if (!rules || rules.length === 0) {
      return; // No commission rules
    }

    const commissionEntries = [];

    // Create commission entries for each item (exclude bonus items)
    for (const item of transaction.items) {
      // Skip bonus items - they don't generate commission
      if (item.isBonus) {
        continue;
      }

      const rule = rules.find(r => r.product_id === item.product.id);

      if (rule && rule.rate_per_qty > 0) {
        const commissionEntry = {
          user_id: transaction.salesId,
          user_name: transaction.salesName,
          role: 'sales' as const,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          rate_per_qty: rule.rate_per_qty,
          amount: item.quantity * rule.rate_per_qty,
          transaction_id: transaction.id,
          ref: `TXN-${transaction.id}`,
          status: 'pending' as const,
          created_at: new Date().toISOString(),
          branch_id: transaction.branchId || null
        };

        commissionEntries.push(commissionEntry);
      }
    }

    // Insert commission entries
    if (commissionEntries.length > 0) {
      const { data: insertedEntries, error: insertError } = await supabase
        .from('commission_entries')
        .insert(commissionEntries)
        .select();

      if (insertError) {
        throw insertError;
      }

      // Create corresponding expense entries automatically
      if (insertedEntries && insertedEntries.length > 0) {
        for (const entry of insertedEntries) {
          try {
            const commissionEntry: CommissionEntry = {
              id: entry.id,
              userId: entry.user_id,
              userName: entry.user_name,
              role: entry.role,
              productId: entry.product_id,
              productName: entry.product_name,
              quantity: entry.quantity,
              ratePerQty: entry.rate_per_qty,
              amount: entry.amount,
              transactionId: entry.transaction_id,
              deliveryId: entry.delivery_id,
              ref: entry.ref,
              status: entry.status,
              createdAt: new Date(entry.created_at)
            };

            await createCommissionExpense(commissionEntry);
          } catch (expenseError) {
            // Don't throw - commission is created successfully, expense is secondary
          }
        }
      }
    }

  } catch (error) {
    throw error;
  }
}

export async function generateDeliveryCommission(delivery: Delivery) {
  try {
    // Get commission rules for driver and helper
    const { data: rules, error: rulesError } = await supabase
      .from('commission_rules')
      .select('*')
      .in('role', ['driver', 'helper', 'delivery_2_helpers', 'delivery_3_helpers']);

    if (rulesError) {
      throw rulesError;
    }

    if (!rules || rules.length === 0) {
      return;
    }

    const commissionEntries = [];

    // Create commission entries for delivered items (exclude bonus items)
    for (const item of delivery.items) {
      // Skip bonus items - they don't generate commission
      const isBonusItem = item.isBonus || item.productName.includes('(Bonus)') || item.productName.includes('BONUS');
      if (isBonusItem) {
        continue;
      }

      const assignedPeople = [];
      const driveId = delivery.driverId || (delivery as any).driver_id;
      const helperId = delivery.helperId || (delivery as any).helper_id;
      const helperId2 = delivery.helperId2 || (delivery as any).helper_id_2 || (delivery as any).helper_id2;
      const helperId3 = delivery.helperId3 || (delivery as any).helper_id_3 || (delivery as any).helper_id3;

      if (driveId) assignedPeople.push({ id: driveId, name: delivery.driverName || (delivery as any).driver_name || 'Unknown Driver', roleLabel: 'driver' });
      if (helperId) assignedPeople.push({ id: helperId, name: delivery.helperName || (delivery as any).helper_name || 'Unknown Helper', roleLabel: 'helper' });
      if (helperId2) assignedPeople.push({ id: helperId2, name: delivery.helperName2 || (delivery as any).helper_name_2 || 'Unknown Helper', roleLabel: 'helper' });
      if (helperId3) assignedPeople.push({ id: helperId3, name: delivery.helperName3 || (delivery as any).helper_name_3 || 'Unknown Helper', roleLabel: 'helper' });

      const helperCount = assignedPeople.filter(p => p.roleLabel === 'helper').length;
      const effectiveDriverId = delivery.driverId || (delivery as any).driver_id;

      const pid = item.productId || (item as any).product_id;
      console.log(`[Commission] SKU: ${item.productName}, PID: ${pid}, Helpers: ${helperCount}, Driver: ${effectiveDriverId}`);

      const rate2HelpersRule = rules.find(r => r.product_id === pid && r.role === 'delivery_2_helpers');
      const rate3HelpersRule = rules.find(r => r.product_id === pid && r.role === 'delivery_3_helpers');
      const driverRule = rules.find(r => r.product_id === pid && r.role === 'driver');
      const helperRule = rules.find(r => r.product_id === pid && r.role === 'helper');

      let appliedRules: { person: any, ruleRate: number, actualRole?: string }[] = [];

      if (helperCount === 3 && effectiveDriverId && rate3HelpersRule && Number(rate3HelpersRule.rate_per_qty || 0) > 0) {
        // 3 helpers + 1 driver = split 4
        const splitRate = Math.floor(Number(rate3HelpersRule.rate_per_qty) / 4);
        console.log(`[Commission] Using SPLIT-4 rule: ${rate3HelpersRule.rate_per_qty} / 4 = ${splitRate}`);
        assignedPeople.forEach(person => {
          appliedRules.push({ person, ruleRate: splitRate });
        });
      } else if (helperCount === 2 && effectiveDriverId && rate2HelpersRule && Number(rate2HelpersRule.rate_per_qty || 0) > 0) {
        // 2 helpers + 1 driver = split 3
        const splitRate = Math.floor(Number(rate2HelpersRule.rate_per_qty) / 3);
        console.log(`[Commission] Using SPLIT-3 rule: ${rate2HelpersRule.rate_per_qty} / 3 = ${splitRate}`);
        assignedPeople.forEach(person => {
          appliedRules.push({ person, ruleRate: splitRate });
        });
      } else {
        // Normal rule (1 driver + 1 helper OR 1 driver only)
        if (helperCount === 0 && effectiveDriverId) {
          // Driver is ALONE (no helpers)
          const dRate = driverRule ? driverRule.rate_per_qty : 0;
          const hRate = helperRule ? helperRule.rate_per_qty : 0;
          const totalRate = dRate + hRate;
          console.log(`[Commission] Driver ALONE: D=${dRate}, H=${hRate}, Total=${totalRate}`);

          if (totalRate > 0) {
            const driverPerson = assignedPeople.find(p => p.roleLabel === 'driver');
            if (driverPerson) {
              if (dRate > 0) appliedRules.push({ person: driverPerson, ruleRate: dRate, actualRole: 'driver' });
              if (hRate > 0) appliedRules.push({ person: driverPerson, ruleRate: hRate, actualRole: 'helper' });
            }
          }
        } else {
          // Normal case or fallback
          console.log(`[Commission] Standard rules fallback. Helpers: ${helperCount}`);
          assignedPeople.forEach(person => {
            const rule = person.roleLabel === 'driver' ? driverRule : helperRule;
            if (rule && rule.rate_per_qty > 0) {
              appliedRules.push({ person, ruleRate: rule.rate_per_qty });
            }
          });
        }
      }

      for (const apply of appliedRules) {
        commissionEntries.push({
          user_id: apply.person.id,
          user_name: apply.person.name,
          role: (apply as any).actualRole || (apply.person.roleLabel as any),
          product_id: pid,
          product_name: item.productName || (item as any).product_name,
          quantity: item.quantityDelivered || (item as any).quantity_delivered,
          rate_per_qty: apply.ruleRate,
          amount: (item.quantityDelivered || (item as any).quantity_delivered || 0) * apply.ruleRate,
          transaction_id: (delivery as any).transactionId || (delivery as any).transaction_id,
          delivery_id: delivery.id,
          ref: `DEL-${delivery.id}`,
          status: 'pending' as const,
          created_at: new Date().toISOString(),
          branch_id: delivery.branchId || (delivery as any).branch_id || null
        });
      }
    }

    // Insert commission entries
    if (commissionEntries.length > 0) {
      const { data: insertedEntries, error: insertError } = await supabase
        .from('commission_entries')
        .insert(commissionEntries)
        .select();

      if (insertError) {
        throw insertError;
      }

      // NOTE: Delivery commission entries are NOT created as expenses
      // They are calculated directly in financial reports from commission_entries table
      // This prevents them from appearing in expense history while still being counted in financial reports
      console.log(`✅ Generated ${insertedEntries?.length || 0} delivery commission entries (not added to expenses)`)
    }

  } catch (error) {
    throw error;
  }
}

export async function regenerateDeliveryCommission(deliveryId: string) {
  try {
    // Get delivery details with items
    const { data: deliveryData, error: deliveryError } = await supabase
      .from('deliveries')
      .select(`
        *,
        items:delivery_items(*),
        driver:driver_id(full_name),
        helper:helper_id(full_name),
        helper2:helper_id_2(full_name),
        helper3:helper_id_3(full_name)
      `)
      .eq('id', deliveryId)
      .single();

    if (deliveryError) throw deliveryError;

    const delivery = Array.isArray(deliveryData) ? deliveryData[0] : deliveryData;
    if (!delivery) {
      throw new Error('Pengantaran tidak ditemukan');
    }

    // Check if commission already exists for this delivery
    const { data: existingCommissions, error: existingError } = await supabase
      .from('commission_entries')
      .select('id')
      .eq('delivery_id', deliveryId);

    if (existingError) throw existingError;

    if (existingCommissions && existingCommissions.length > 0) {
      // Delete existing commission entries for this delivery first
      const { error: deleteError } = await supabase
        .from('commission_entries')
        .delete()
        .eq('delivery_id', deliveryId);

      if (deleteError) throw deleteError;
      console.log(`🗑️ Deleted ${existingCommissions.length} existing commission entries for delivery ${deliveryId}`);
    }

    const { data: rules, error: rulesError } = await supabase
      .from('commission_rules')
      .select('*')
      .in('role', ['driver', 'helper', 'delivery_2_helpers', 'delivery_3_helpers']);

    if (rulesError) throw rulesError;

    if (!rules || rules.length === 0) {
      console.log('⚠️ No commission rules found for driver/helper');
      return { success: true, message: 'Tidak ada aturan komisi untuk driver/helper', entriesCreated: 0 };
    }

    const commissionEntries = [];

    // Create commission entries for delivered items (exclude bonus items)
    for (const item of (delivery.items || [])) {
      // Skip bonus items
      const isBonusItem = item.is_bonus || item.product_name?.includes('(Bonus)') || item.product_name?.includes('BONUS');
      if (isBonusItem) {
        continue;
      }

      const assignedPeople = [];
      const driveId = delivery.driver_id || (delivery as any).driverId;
      const helperId = delivery.helper_id || (delivery as any).helperId;
      const helperId2 = delivery.helper_id_2 || (delivery as any).helperId2 || (delivery as any).helper_id2;
      const helperId3 = delivery.helper_id_3 || (delivery as any).helperId3 || (delivery as any).helper_id3;

      if (driveId) assignedPeople.push({ id: driveId, name: delivery.driver?.full_name || delivery.driverName || 'Unknown Driver', roleLabel: 'driver' });
      if (helperId) assignedPeople.push({ id: helperId, name: delivery.helper?.full_name || delivery.helperName || 'Unknown Helper', roleLabel: 'helper' });
      if (helperId2) assignedPeople.push({ id: helperId2, name: delivery.helper2?.full_name || delivery.helperName2 || 'Unknown Helper', roleLabel: 'helper' });
      if (helperId3) assignedPeople.push({ id: helperId3, name: delivery.helper3?.full_name || delivery.helperName3 || 'Unknown Helper', roleLabel: 'helper' });

      const helperCount = assignedPeople.filter(p => p.roleLabel === 'helper').length;
      const effectiveDriverId = delivery.driver_id || (delivery as any).driverId;

      const ruleProductId = item.product_id || (item as any).productId;
      const rate2HelpersRule = rules.find(r => r.product_id === ruleProductId && r.role === 'delivery_2_helpers');
      const rate3HelpersRule = rules.find(r => r.product_id === ruleProductId && r.role === 'delivery_3_helpers');
      const driverRule = rules.find(r => r.product_id === ruleProductId && r.role === 'driver');
      const helperRule = rules.find(r => r.product_id === ruleProductId && r.role === 'helper');

      console.log(`[Regen] Item: ${item.product_name}, Helpers: ${helperCount}, Driver: ${effectiveDriverId}, Rules:`, {
        r2: rate2HelpersRule?.rate_per_qty,
        r3: rate3HelpersRule?.rate_per_qty,
        d: driverRule?.rate_per_qty,
        h: helperRule?.rate_per_qty
      });

      let appliedRules: { person: any, ruleRate: number, actualRole?: string }[] = [];

      if (helperCount === 3 && effectiveDriverId && rate3HelpersRule && rate3HelpersRule.rate_per_qty > 0) {
        const totalAmount = Number(rate3HelpersRule.rate_per_qty);
        const splitRate = Math.floor(totalAmount / 4);
        console.log(`[RegenCommission] SPLIT-4 (Bagi 4): ${totalAmount} / 4 = ${splitRate}`);
        assignedPeople.forEach(person => {
          appliedRules.push({ person, ruleRate: splitRate });
        });
      } else if (helperCount === 2 && effectiveDriverId && rate2HelpersRule && rate2HelpersRule.rate_per_qty > 0) {
        const totalAmount = Number(rate2HelpersRule.rate_per_qty);
        const splitRate = Math.floor(totalAmount / 3);
        console.log(`[RegenCommission] SPLIT-3 (Bagi 3): ${totalAmount} / 3 = ${splitRate}`);
        assignedPeople.forEach(person => {
          appliedRules.push({ person, ruleRate: splitRate });
        });
      } else {
        // Normal rule (1 driver + 1 helper OR 1 driver only)
        if (helperCount === 0 && effectiveDriverId) {
          // Driver is ALONE (no helpers)
          const dRate = driverRule ? driverRule.rate_per_qty : 0;
          const hRate = helperRule ? helperRule.rate_per_qty : 0;
          const totalRate = dRate + hRate;
          console.log(`[RegenCommission] Driver ALONE: D=${dRate}, H=${hRate}, Total=${totalRate}`);

          if (totalRate > 0) {
            const driverPerson = assignedPeople.find(p => p.roleLabel === 'driver');
            if (driverPerson) {
              if (dRate > 0) appliedRules.push({ person: driverPerson, ruleRate: dRate, actualRole: 'driver' });
              if (hRate > 0) appliedRules.push({ person: driverPerson, ruleRate: hRate, actualRole: 'helper' });
            }
          }
        } else {
          // Normal case or fallback
          console.log(`[RegenCommission] Fallback rules. Helpers: ${helperCount}`);
          assignedPeople.forEach(person => {
            const rule = person.roleLabel === 'driver' ? driverRule : helperRule;
            if (rule && rule.rate_per_qty > 0) {
              appliedRules.push({ person, ruleRate: rule.rate_per_qty });
            }
          });
        }
      }

      for (const apply of appliedRules) {
        commissionEntries.push({
          user_id: apply.person.id,
          user_name: apply.person.name,
          role: (apply as any).actualRole || (apply.person.roleLabel as any),
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity_delivered,
          rate_per_qty: apply.ruleRate,
          amount: item.quantity_delivered * apply.ruleRate,
          transaction_id: delivery.transaction_id,
          delivery_id: delivery.id,
          ref: `DEL-${delivery.id}`,
          status: 'pending' as const,
          created_at: new Date().toISOString(),
          branch_id: delivery.branch_id || null
        });
      }
    }

    // Insert commission entries
    if (commissionEntries.length > 0) {
      const { data: insertedEntries, error: insertError } = await supabase
        .from('commission_entries')
        .insert(commissionEntries)
        .select();

      if (insertError) throw insertError;

      console.log(`✅ Regenerated ${insertedEntries?.length || 0} commission entries for delivery ${deliveryId}`);
      return {
        success: true,
        message: `Berhasil generate ${insertedEntries?.length || 0} komisi`,
        entriesCreated: insertedEntries?.length || 0
      };
    }

    return {
      success: true,
      message: 'Tidak ada item yang memenuhi syarat komisi',
      entriesCreated: 0
    };

  } catch (error: any) {
    console.error('Error regenerating delivery commission:', error);
    throw error;
  }
}

/**
 * Recalculate commissions for all deliveries AND transactions in a date range
 * Supports ALL roles: sales, driver, helper, operator, supervisor
 * - Creates new commission entries for items without commissions
 * - Updates commission amounts if rates changed (only for 'pending' status)
 * - Skips entries with 'paid' status
 */
export async function recalculateCommissionsForPeriod(startDate: Date, endDate: Date) {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    // Get ALL commission rules (for all roles)
    const { data: allRules, error: rulesError } = await supabase
      .from('commission_rules')
      .select('*');

    if (rulesError) throw rulesError;

    if (!allRules || allRules.length === 0) {
      return { created: 0, updated: 0, skipped: 0, message: 'Tidak ada aturan komisi yang diatur' };
    }

    // Group rules by role
    const rulesByRole = allRules.reduce((acc, rule) => {
      if (!acc[rule.role]) acc[rule.role] = [];
      acc[rule.role].push(rule);
      return acc;
    }, {} as Record<string, any[]>);

    const availableRoles = Object.keys(rulesByRole);
    console.log(`📋 Found commission rules for roles: ${availableRoles.join(', ')}`);

    const newEntries: any[] = [];
    const updateEntries: { id: string; amount: number; rate_per_qty: number }[] = [];

    // ========== PART 1: Process DELIVERIES (driver, helper) ==========
    if (rulesByRole['driver'] || rulesByRole['helper'] || rulesByRole['delivery_2_helpers'] || rulesByRole['delivery_3_helpers']) {
      const { data: deliveries, error: deliveriesError } = await supabase
        .from('deliveries')
        .select(`
          id,
          transaction_id,
          delivery_date,
          driver_id,
          helper_id,
          helper_id_2,
          helper_id_3,
          branch_id,
          items:delivery_items(id, product_id, product_name, quantity_delivered, is_bonus),
          driver:driver_id(full_name),
          helper:helper_id(full_name),
          helper2:helper_id_2(full_name),
          helper3:helper_id_3(full_name)
        `)
        .gte('delivery_date', startDate.toISOString())
        .lte('delivery_date', endDate.toISOString())
        .or('driver_id.not.is.null,helper_id.not.is.null');

      if (deliveriesError) throw deliveriesError;

      if (deliveries && deliveries.length > 0) {
        // Get existing commission entries for deliveries
        const deliveryIds = deliveries.map(d => d.id);
        const { data: existingDeliveryCommissions } = await supabase
          .from('commission_entries')
          .select('id, delivery_id, product_id, role, status, amount, rate_per_qty, user_id')
          .in('delivery_id', deliveryIds);

        const deliveryExistingMap = new Map<string, any>();
        for (const c of (existingDeliveryCommissions || [])) {
          const key = `${c.delivery_id}-${c.product_id}-${c.role}-${c.user_id}`;
          deliveryExistingMap.set(key, c);
        }

        // Process each delivery
        for (const delivery of deliveries) {
          for (const item of (delivery.items || [])) {
            // Skip bonus items
            if (item.is_bonus || item.product_name?.includes('(Bonus)') || item.product_name?.includes('BONUS')) {
              continue;
            }

            const assignedPeople = [];
            if (delivery.driver_id) assignedPeople.push({ id: delivery.driver_id, name: (delivery.driver as any)?.full_name || 'Unknown Driver', roleLabel: 'driver' });
            if (delivery.helper_id) assignedPeople.push({ id: delivery.helper_id, name: (delivery.helper as any)?.full_name || 'Unknown Helper', roleLabel: 'helper' });
            if (delivery.helper_id_2) assignedPeople.push({ id: delivery.helper_id_2, name: (delivery.helper2 as any)?.full_name || 'Unknown Helper', roleLabel: 'helper' });
            if (delivery.helper_id_3) assignedPeople.push({ id: delivery.helper_id_3, name: (delivery.helper3 as any)?.full_name || 'Unknown Helper', roleLabel: 'helper' });

            const helperCount = assignedPeople.filter(p => p.roleLabel === 'helper').length;
            const effectiveDriverId = delivery.driver_id || (delivery as any).driverId;
            const pid = item.product_id || (item as any).productId;

            const rate2HelpersRule = rulesByRole['delivery_2_helpers']?.find((r: any) => r.product_id === pid);
            const rate3HelpersRule = rulesByRole['delivery_3_helpers']?.find((r: any) => r.product_id === pid);
            const driverRule = rulesByRole['driver']?.find((r: any) => r.product_id === pid);
            const helperRule = rulesByRole['helper']?.find((r: any) => r.product_id === pid);

            console.log(`[Recalc] SKU: ${item.product_name}, PID: ${pid}, Helpers: ${helperCount}, Driver: ${effectiveDriverId}, Rules:`, {
              r2: rate2HelpersRule?.rate_per_qty,
              r3: rate3HelpersRule?.rate_per_qty,
              d: driverRule?.rate_per_qty,
              h: helperRule?.rate_per_qty
            });

            let appliedRules: { person: any, ruleRate: number, actualRole?: string }[] = [];

            if (helperCount === 3 && effectiveDriverId && rate3HelpersRule && Number(rate3HelpersRule.rate_per_qty || 0) > 0) {
              const splitRate = Math.floor(Number(rate3HelpersRule.rate_per_qty) / 4);
              assignedPeople.forEach(person => {
                appliedRules.push({ person, ruleRate: splitRate });
              });
            } else if (helperCount === 2 && effectiveDriverId && rate2HelpersRule && Number(rate2HelpersRule.rate_per_qty || 0) > 0) {
              const splitRate = Math.floor(Number(rate2HelpersRule.rate_per_qty) / 3);
              assignedPeople.forEach(person => {
                appliedRules.push({ person, ruleRate: splitRate });
              });
            } else {
              if (helperCount === 0 && effectiveDriverId) {
                // Driver is ALONE (no helpers)
                const driverRate = driverRule ? driverRule.rate_per_qty : 0;
                const helperRate = helperRule ? helperRule.rate_per_qty : 0;
                const totalRate = driverRate + helperRate;

                if (totalRate > 0) {
                  const driverPerson = assignedPeople.find(p => p.roleLabel === 'driver');
                  if (driverPerson) {
                    // Create entry for Driver commission
                    if (driverRate > 0) {
                      appliedRules.push({ person: driverPerson, ruleRate: driverRate, actualRole: 'driver' } as any);
                    }
                    // Create entry for Helper commission (but assigned to Driver)
                    if (helperRate > 0) {
                      appliedRules.push({ person: driverPerson, ruleRate: helperRate, actualRole: 'helper' } as any);
                    }
                  }
                }
              } else {
                // Normal case or fallback
                assignedPeople.forEach(person => {
                  const rule = person.roleLabel === 'driver' ? driverRule : helperRule;
                  if (rule && rule.rate_per_qty > 0) {
                    appliedRules.push({ person, ruleRate: rule.rate_per_qty });
                  }
                });
              }
            }

            for (const apply of appliedRules) {
              const appliedRole = (apply as any).actualRole || apply.person.roleLabel;
              const key = `${delivery.id}-${item.product_id}-${appliedRole}-${apply.person.id}`;
              const existing = deliveryExistingMap.get(key);

              const newAmount = item.quantity_delivered * apply.ruleRate;

              if (existing) {
                if (existing.status === 'paid') {
                  skipped++;
                } else if (existing.amount !== newAmount || existing.rate_per_qty !== apply.ruleRate) {
                  updateEntries.push({ id: existing.id, amount: newAmount, rate_per_qty: apply.ruleRate });
                  updated++;
                }
              } else {
                newEntries.push({
                  user_id: apply.person.id,
                  user_name: apply.person.name,
                  role: appliedRole,
                  product_id: item.product_id,
                  product_name: item.product_name,
                  quantity: item.quantity_delivered,
                  rate_per_qty: apply.ruleRate,
                  amount: newAmount,
                  transaction_id: delivery.transaction_id,
                  delivery_id: delivery.id,
                  ref: `DEL-${delivery.id}`,
                  status: 'pending',
                  created_at: delivery.delivery_date,
                  branch_id: delivery.branch_id || null
                });
                created++;
              }
            }
          }
        }
      }
    }

    // ========== PART 2: Process TRANSACTIONS (sales, operator, supervisor) ==========
    if (rulesByRole['sales'] || rulesByRole['operator'] || rulesByRole['supervisor']) {
      const { data: transactions, error: transactionsError } = await supabase
        .from('transactions')
        .select(`
          id,
          order_date,
          sales_id,
          sales_name,
          operator_id,
          branch_id,
          items,
          sales:profiles!sales_id(full_name),
          operator:profiles!operator_id(full_name)
        `)
        .gte('order_date', startDate.toISOString())
        .lte('order_date', endDate.toISOString())
        .eq('is_voided', false)
        .eq('is_cancelled', false);

      if (transactionsError) throw transactionsError;

      // Get supervisors per branch (for supervisor commission)
      let supervisorsByBranch: Map<string, any[]> = new Map();
      if (rulesByRole['supervisor'] && transactions && transactions.length > 0) {
        const branchIds = [...new Set(transactions.map(t => t.branch_id).filter(Boolean))];
        if (branchIds.length > 0) {
          const { data: supervisors } = await supabase
            .from('profiles')
            .select('id, full_name, branch_id')
            .eq('role', 'supervisor')
            .in('branch_id', branchIds);

          for (const sup of (supervisors || [])) {
            if (!supervisorsByBranch.has(sup.branch_id)) {
              supervisorsByBranch.set(sup.branch_id, []);
            }
            supervisorsByBranch.get(sup.branch_id)!.push(sup);
          }
        }
      }

      if (transactions && transactions.length > 0) {
        // Get existing commission entries for transactions
        const transactionIds = transactions.map(t => t.id);
        const { data: existingTxnCommissions } = await supabase
          .from('commission_entries')
          .select('id, transaction_id, product_id, role, status, amount, rate_per_qty, user_id')
          .in('transaction_id', transactionIds)
          .is('delivery_id', null); // Only transaction-based commissions (not delivery)

        const txnExistingMap = new Map<string, any>();
        for (const c of (existingTxnCommissions || [])) {
          // For supervisor, include user_id in key since multiple supervisors can get commission
          const key = c.role === 'supervisor'
            ? `${c.transaction_id}-${c.product_id}-${c.role}-${c.user_id}`
            : `${c.transaction_id}-${c.product_id}-${c.role}`;
          txnExistingMap.set(key, c);
        }

        // Process each transaction
        for (const txn of transactions) {
          const items = txn.items || [];

          for (const item of items) {
            // Skip bonus items
            if (item.isBonus || item.product?.name?.includes('(Bonus)') || item.product?.name?.includes('BONUS')) {
              continue;
            }

            const productId = item.product?.id || item.productId;
            const productName = item.product?.name || item.productName;
            const quantity = item.quantity || 0;

            if (!productId || quantity <= 0) continue;

            // Check sales commission
            if (txn.sales_id && rulesByRole['sales']) {
              const salesRule = rulesByRole['sales'].find((r: any) => r.product_id === productId);
              const key = `${txn.id}-${productId}-sales`;
              const existing = txnExistingMap.get(key);

              if (salesRule && salesRule.rate_per_qty > 0) {
                const newAmount = quantity * salesRule.rate_per_qty;

                if (existing) {
                  if (existing.status === 'paid') {
                    skipped++;
                  } else if (existing.amount !== newAmount || existing.rate_per_qty !== salesRule.rate_per_qty) {
                    updateEntries.push({ id: existing.id, amount: newAmount, rate_per_qty: salesRule.rate_per_qty });
                    updated++;
                  }
                } else {
                  newEntries.push({
                    user_id: txn.sales_id,
                    user_name: (txn.sales as any)?.full_name || txn.sales_name || 'Unknown Sales',
                    role: 'sales',
                    product_id: productId,
                    product_name: productName,
                    quantity: quantity,
                    rate_per_qty: salesRule.rate_per_qty,
                    amount: newAmount,
                    transaction_id: txn.id,
                    delivery_id: null,
                    ref: `TXN-${txn.id}`,
                    status: 'pending',
                    created_at: txn.order_date,
                    branch_id: txn.branch_id || null
                  });
                  created++;
                }
              }
            }

            // Check operator commission
            if (txn.operator_id && rulesByRole['operator']) {
              const operatorRule = rulesByRole['operator'].find((r: any) => r.product_id === productId);
              const key = `${txn.id}-${productId}-operator`;
              const existing = txnExistingMap.get(key);

              if (operatorRule && operatorRule.rate_per_qty > 0) {
                const newAmount = quantity * operatorRule.rate_per_qty;

                if (existing) {
                  if (existing.status === 'paid') {
                    skipped++;
                  } else if (existing.amount !== newAmount || existing.rate_per_qty !== operatorRule.rate_per_qty) {
                    updateEntries.push({ id: existing.id, amount: newAmount, rate_per_qty: operatorRule.rate_per_qty });
                    updated++;
                  }
                } else {
                  newEntries.push({
                    user_id: txn.operator_id,
                    user_name: (txn.operator as any)?.full_name || 'Unknown Operator',
                    role: 'operator',
                    product_id: productId,
                    product_name: productName,
                    quantity: quantity,
                    rate_per_qty: operatorRule.rate_per_qty,
                    amount: newAmount,
                    transaction_id: txn.id,
                    delivery_id: null,
                    ref: `TXN-${txn.id}`,
                    status: 'pending',
                    created_at: txn.order_date,
                    branch_id: txn.branch_id || null
                  });
                  created++;
                }
              }
            }

            // Check supervisor commission - supervisors in the same branch get commission from all transactions
            if (rulesByRole['supervisor'] && txn.branch_id) {
              const branchSupervisors = supervisorsByBranch.get(txn.branch_id) || [];
              const supervisorRule = rulesByRole['supervisor'].find((r: any) => r.product_id === productId);

              if (supervisorRule && supervisorRule.rate_per_qty > 0) {
                const newAmount = quantity * supervisorRule.rate_per_qty;

                for (const supervisor of branchSupervisors) {
                  const key = `${txn.id}-${productId}-supervisor-${supervisor.id}`;
                  const existing = txnExistingMap.get(key);

                  if (existing) {
                    if (existing.status === 'paid') {
                      skipped++;
                    } else if (existing.amount !== newAmount || existing.rate_per_qty !== supervisorRule.rate_per_qty) {
                      updateEntries.push({ id: existing.id, amount: newAmount, rate_per_qty: supervisorRule.rate_per_qty });
                      updated++;
                    }
                  } else {
                    newEntries.push({
                      user_id: supervisor.id,
                      user_name: supervisor.full_name || 'Unknown Supervisor',
                      role: 'supervisor',
                      product_id: productId,
                      product_name: productName,
                      quantity: quantity,
                      rate_per_qty: supervisorRule.rate_per_qty,
                      amount: newAmount,
                      transaction_id: txn.id,
                      delivery_id: null,
                      ref: `TXN-${txn.id}`,
                      status: 'pending',
                      created_at: txn.order_date,
                      branch_id: txn.branch_id || null
                    });
                    created++;
                  }
                }
              }
            }
          }
        }
      }
    }

    // ========== PART 3: Insert and Update ==========

    // Insert new entries in batches
    if (newEntries.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < newEntries.length; i += BATCH_SIZE) {
        const batch = newEntries.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
          .from('commission_entries')
          .insert(batch);

        if (insertError) {
          console.error('Error inserting commission entries batch:', insertError);
        }
      }
    }

    // Update existing entries
    for (const entry of updateEntries) {
      const { error: updateError } = await supabase
        .from('commission_entries')
        .update({ amount: entry.amount, rate_per_qty: entry.rate_per_qty })
        .eq('id', entry.id);

      if (updateError) {
        console.error('Error updating commission entry:', updateError);
      }
    }

    console.log(`✅ Recalculate complete: ${created} created, ${updated} updated, ${skipped} skipped`);
    return { created, updated, skipped };

  } catch (error: any) {
    console.error('Error recalculating commissions:', error);
    throw error;
  }
}

export async function getCommissionSummary(userId?: string, startDate?: Date, endDate?: Date) {
  try {
    let query = supabase
      .from('commission_entries')
      .select('*');

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (startDate) {
      query = query.gte('created_at', startDate.toISOString());
    }

    if (endDate) {
      query = query.lte('created_at', endDate.toISOString());
    }

    const { data: entries, error } = await query;

    if (error) throw error;

    // Calculate summary
    const summary = entries?.reduce((acc, entry) => {
      const key = `${entry.user_id}-${entry.role}`;

      if (!acc[key]) {
        acc[key] = {
          userId: entry.user_id,
          userName: entry.user_name,
          role: entry.role,
          totalAmount: 0,
          totalQuantity: 0,
          entryCount: 0
        };
      }

      acc[key].totalAmount += entry.amount;
      acc[key].totalQuantity += entry.quantity;
      acc[key].entryCount += 1;

      return acc;
    }, {} as Record<string, {
      userId: string;
      userName: string;
      role: string;
      totalAmount: number;
      totalQuantity: number;
      entryCount: number;
    }>);

    return Object.values(summary || {});

  } catch (error) {
    console.error('Error getting commission summary:', error);
    throw error;
  }
}