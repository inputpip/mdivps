--
-- PostgreSQL database dump
--

\restrict FKiHOeMUODNAROdPykK3HGi8xMIfKfPkhfEc2hn4OCHJ2XR81T49Adu2Dsy6R7e

-- Dumped from database version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id text NOT NULL,
    delivery_number integer NOT NULL,
    delivery_date timestamp with time zone DEFAULT now() NOT NULL,
    photo_url text,
    photo_drive_id text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id uuid,
    driver_id uuid,
    helper_id uuid,
    driver_name text,
    helper_name text,
    helper_id_2 uuid,
    helper_name_2 text,
    helper_id_3 uuid,
    helper_name_3 text,
    customer_name text,
    customer_address text,
    customer_phone text,
    is_cancelled boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_by_name text,
    cancel_reason text,
    hpp_total numeric DEFAULT 0,
    hpp_snapshot jsonb,
    status text DEFAULT 'delivered'::text,
    CONSTRAINT delivery_number_positive CHECK ((delivery_number > 0))
);


--
-- Name: deliveries deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);


--
-- Name: deliveries deliveries_transaction_delivery_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_transaction_delivery_number_key UNIQUE (transaction_id, delivery_number);


--
-- Name: idx_deliveries_delivery_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_delivery_date ON public.deliveries USING btree (delivery_date);


--
-- Name: idx_deliveries_not_cancelled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_not_cancelled ON public.deliveries USING btree (id) WHERE ((is_cancelled = false) OR (is_cancelled IS NULL));


--
-- Name: idx_deliveries_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_transaction_id ON public.deliveries USING btree (transaction_id);


--
-- Name: deliveries deliveries_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: deliveries deliveries_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id);


--
-- Name: deliveries deliveries_helper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_helper_id_fkey FOREIGN KEY (helper_id) REFERENCES public.profiles(id);

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_helper_id_2_fkey FOREIGN KEY (helper_id_2) REFERENCES public.profiles(id);

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_helper_id_3_fkey FOREIGN KEY (helper_id_3) REFERENCES public.profiles(id);


--
-- Name: deliveries deliveries_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: deliveries deliveries_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deliveries_allow_all ON public.deliveries TO authenticated USING (true) WITH CHECK (true);


--
-- Name: deliveries deliveries_select_returning; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deliveries_select_returning ON public.deliveries FOR SELECT TO authenticated USING (true);


--
-- PostgreSQL database dump complete
--

\unrestrict FKiHOeMUODNAROdPykK3HGi8xMIfKfPkhfEc2hn4OCHJ2XR81T49Adu2Dsy6R7e

