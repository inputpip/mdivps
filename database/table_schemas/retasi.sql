--
-- PostgreSQL database dump
--

\restrict gutlnL2HHVPQdpaM5F4oN33C6FAnGd95Xh8cmekhoZPmhkU6i4FkShm3X7hXGwg

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
-- Name: retasi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retasi (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    retasi_number text NOT NULL,
    truck_number text,
    driver_name text,
    helper_name text,
    departure_date date NOT NULL,
    departure_time time without time zone,
    route text,
    total_items integer DEFAULT 0,
    total_weight numeric(10,2),
    notes text,
    retasi_ke integer DEFAULT 1 NOT NULL,
    is_returned boolean DEFAULT false,
    returned_items_count integer DEFAULT 0,
    error_items_count integer DEFAULT 0,
    return_notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    barang_laku integer DEFAULT 0,
    branch_id uuid,
    driver_id uuid,
    helper_id uuid,
    date date DEFAULT CURRENT_DATE,
    status text DEFAULT 'open'::text,
    barang_tidak_laku integer DEFAULT 0,
    helper_id_2 uuid,
    helper_name_2 text,
    helper_id_3 uuid,
    helper_name_3 text
);


--
-- Name: COLUMN retasi.barang_laku; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.retasi.barang_laku IS 'Jumlah barang yang laku terjual dari retasi';


--
-- Name: retasi retasi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_pkey PRIMARY KEY (id);


--
-- Name: retasi retasi_retasi_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_retasi_number_key UNIQUE (retasi_number);


--
-- Name: idx_retasi_departure_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retasi_departure_date ON public.retasi USING btree (departure_date);


--
-- Name: idx_retasi_driver_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retasi_driver_date ON public.retasi USING btree (driver_name, departure_date);


--
-- Name: idx_retasi_returned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retasi_returned ON public.retasi USING btree (is_returned);


--
-- Name: retasi retasi_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: retasi retasi_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id);


--
-- Name: retasi retasi_helper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_helper_id_fkey FOREIGN KEY (helper_id) REFERENCES public.profiles(id);


--
-- Name: retasi retasi_helper_id_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_helper_id_2_fkey FOREIGN KEY (helper_id_2) REFERENCES public.profiles(id);


--
-- Name: retasi retasi_helper_id_3_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_helper_id_3_fkey FOREIGN KEY (helper_id_3) REFERENCES public.profiles(id);


--
-- Name: retasi retasi_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retasi_allow_all ON public.retasi TO authenticated USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict gutlnL2HHVPQdpaM5F4oN33C6FAnGd95Xh8cmekhoZPmhkU6i4FkShm3X7hXGwg

