-- Check permissions and enable for authenticated role
GRANT ALL ON TABLE delivery_reports TO authenticated;
GRANT ALL ON TABLE delivery_reports TO supir;
GRANT ALL ON TABLE delivery_reports TO helper;
GRANT ALL ON TABLE deliveries TO authenticated;
GRANT ALL ON TABLE deliveries TO supir;
GRANT ALL ON TABLE deliveries TO helper;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO supir;
GRANT USAGE ON SCHEMA public TO helper;
