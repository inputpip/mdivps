--
-- PostgreSQL database dump
--

\restrict QbfGZi2QM2STbipOJvmaZWsHudcuZz7CTcrC9po1GtVf2a2HjNGhdzhUE8DMcSh

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
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    barcode text,
    base_price numeric NOT NULL,
    unit text NOT NULL,
    min_order integer NOT NULL,
    description text,
    specifications jsonb,
    materials jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'Produksi'::text,
    current_stock numeric DEFAULT 0,
    min_stock numeric DEFAULT 0,
    branch_id uuid,
    cost_price numeric(15,2),
    is_shared boolean DEFAULT false,
    initial_stock numeric DEFAULT 0
);


--
-- Name: COLUMN products.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.type IS 'Jenis barang: Stock (produksi menurunkan stock), Beli (produksi menambah stock)';


--
-- Name: COLUMN products.current_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.current_stock IS 'Stock saat ini';


--
-- Name: COLUMN products.min_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.min_stock IS 'Stock minimum untuk alert';


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: idx_products_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name ON public.products USING btree (name);


--
-- Name: products products_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: products products_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_allow_all ON public.products TO authenticated USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict QbfGZi2QM2STbipOJvmaZWsHudcuZz7CTcrC9po1GtVf2a2HjNGhdzhUE8DMcSh

